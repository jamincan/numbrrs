/**
 * Measures the origin's sustained request ceiling.
 *
 * This exists to replace one estimate with a measurement. docs/hosting.md's
 * "Where it breaks" puts the current machine at "~5–15 req/s", which is a guess,
 * and it is the guess that decides whether a modest Reddit post (~8 req/s) or a
 * good one (~33 req/s) survives. Everything below is arranged to produce a real
 * number for that line.
 *
 * Point BASE_URL at the Fly hostname directly, never at numbrrs.app. Through
 * Cloudflare this would mostly measure cache hits — that is a useful test, but
 * it is a test of the CDN, not of the origin, and the origin is the thing whose
 * ceiling is unknown.
 *
 * `ramping-arrival-rate` is deliberate. An open model holds the *arrival* rate
 * fixed regardless of how slow responses get, which is what a crowd arriving
 * from a link actually does. The closed VU model would wait for each response
 * before sending the next, quietly throttling itself to whatever the server can
 * manage and reporting no failure at all — it cannot find a ceiling by
 * construction.
 *
 * Run:
 *   k6 run -e BASE_URL=https://numbrrs-loadtest.fly.dev load-test/k6-origin.js
 */

import http from 'k6/http';
import { check } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL;
if (!BASE_URL) throw new Error('Set BASE_URL, e.g. -e BASE_URL=https://numbrrs-loadtest.fly.dev');
if (BASE_URL.includes('numbrrs.app')) {
	throw new Error('BASE_URL points at the CDN. Use the .fly.dev hostname to measure the origin.');
}

/** Per-route latency, because the team grid and a roster page are not alike. */
const homeLatency = new Trend('route_home', true);
const gameLatency = new Trend('route_game', true);
const failureRate = new Rate('route_failures');

/**
 * Reddit traffic concentrates on a handful of URLs, so this is a small fixed
 * set rather than a broad sample — a wide spread would understate the caching
 * and overstate the load. Codes are real, so they exist after a resync.
 */
const TEAMS = [
	['nhl', 'TOR'],
	['nhl', 'MTL'],
	['nhl', 'EDM'],
	['nhl', 'VAN'],
	['pwhl', 'TOR'],
	['whl', 'CGY'],
	['ohl', 'LDN']
];

/**
 * With RATE set, run a flat two-minute hold at that arrival rate instead of the
 * full ramp. The ramp finds that a ceiling exists; a flat hold is what pins down
 * where, because k6's end-of-test summary aggregates every stage together and a
 * p95 taken across seven rates describes none of them.
 */
const RATE = Number(__ENV.RATE) || 0;

const flat = {
	ramp: {
		executor: 'constant-arrival-rate',
		rate: RATE,
		timeUnit: '1s',
		duration: __ENV.DURATION || '2m',
		// Concurrency is rate × latency, not rate × a guess. At 50 req/s and ~50ms
		// that is ~3 simultaneous requests, so a few dozen VUs is generous. An
		// earlier version of this used RATE * 20, which allocated 2000 VUs for the
		// 100 req/s run, exhausted Windows' ephemeral ports, and produced a 62%
		// "failure" rate that was entirely the load generator failing to open
		// sockets. Over-allocating VUs does not make a test stricter; it makes the
		// client the thing under test.
		preAllocatedVUs: 50,
		maxVUs: 100
	}
};

export const options = {
	// Each stage holds a fixed arrival rate for two minutes. Two minutes matters
	// on Fly's shared CPU: a burst rides the burst-credit balance and looks fine,
	// so a short stage measures the credits rather than the machine. The knee is
	// the first stage where p95 climbs sharply or failures leave zero.
	scenarios: RATE
		? flat
		: {
				ramp: {
					executor: 'ramping-arrival-rate',
					startRate: 1,
					timeUnit: '1s',
					// Generous, so the generator is never the bottleneck. If k6 warns about
					// insufficient VUs, the numbers past that point are the generator's
					// limit and not the server's — raise maxVUs and re-run.
					preAllocatedVUs: 50,
					maxVUs: 400,
					stages: [
						{ target: 1, duration: '30s' }, // settle
						{ target: 5, duration: '2m' },
						{ target: 10, duration: '2m' }, // bottom of the hosting.md estimate
						{ target: 20, duration: '2m' },
						{ target: 35, duration: '2m' }, // "good post" — the number that matters
						{ target: 50, duration: '2m' },
						{ target: 100, duration: '2m' } // "big post"
					]
				}
			},

	// Deliberately not `abortOnFail`. The point is to watch it degrade past the
	// ceiling, not to stop at the first sign of strain.
	thresholds: {
		route_failures: ['rate<0.01'],
		http_req_duration: ['p(95)<1000']
	},

	// Note for anyone reading these numbers: the 2026-07-29 run never came close
	// to fly.toml's hard_limit = 25. Concurrency is rate × latency, so 100 req/s
	// at 12ms is ~1.5 simultaneous connections. Shedding is not what this measures
	// on current hardware; the burst-credit latency tail is.
	insecureSkipTLSVerify: false,
	noConnectionReuse: false
};

export default function () {
	// Roughly the shape of an arriving visitor: most land on the home page and
	// click into a team, some arrive on a team page directly from a comment link.
	const roll = Math.random();

	if (roll < 0.3) {
		const res = http.get(`${BASE_URL}/`, { tags: { route: 'home' } });
		homeLatency.add(res.timings.duration);
		failureRate.add(!check(res, { 'home 200': (r) => r.status === 200 }));
	} else {
		const [league, code] = TEAMS[Math.floor(Math.random() * TEAMS.length)];
		// A tenth of traffic on the French path, which is a separate render and a
		// separate cache slot in the Worker.
		const prefix = roll > 0.93 ? '/fr' : '';
		const res = http.get(`${BASE_URL}${prefix}/game/${league}/${code}`, {
			tags: { route: 'game' }
		});
		gameLatency.add(res.timings.duration);
		failureRate.add(!check(res, { 'game 200': (r) => r.status === 200 }));
	}
}
