import { describe, expect, it, vi } from 'vitest';
import {
	USER_AGENT,
	advance,
	blindAlert,
	createMonitor,
	emptyState,
	evaluateHealth,
	evaluatePage,
	evaluateStatus,
	formatDuration,
	formatNotices,
	parseState,
	quote,
	serialize,
	type Env,
	type MonitorState,
	type Observation,
	type Outcome
} from './uptime-worker';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const RUN = 5 * MINUTE;
/** On the hour, which is one of the slots a blind monitor is allowed to speak in. */
const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);

const WEBHOOK = 'https://discord.test/api/webhooks/1/secret-token';

const PAGE =
	'<!doctype html><html lang="en"><head><title>Numbrrs</title>' +
	'<meta property="og:site_name" content="Numbrrs"/>' +
	'<link rel="modulepreload" href="./_app/immutable/entry/start.abc.js"></head>' +
	'<body><h1>Numbrrs</h1></body></html>';

function json(body: unknown, status = 200): Outcome {
	return {
		kind: 'response',
		status,
		contentType: 'application/json',
		body: JSON.stringify(body)
	};
}

function html(body: string, status = 200): Outcome {
	return { kind: 'response', status, contentType: 'text/html; charset=utf-8', body };
}

interface StatusOverrides {
	ok?: boolean;
	bootedAt?: number;
	checks?: Record<string, unknown>;
}

function statusReport(overrides: StatusOverrides = {}): Record<string, unknown> {
	return {
		ok: overrides.ok ?? true,
		at: T0,
		build: '1795000000000',
		process: { bootedAt: overrides.bootedAt ?? T0 - 48 * HOUR, uptimeSeconds: 172_800 },
		checks: {
			database: { ok: true },
			write: { ok: true },
			disk: {
				ok: true,
				freeBytes: 900_000_000,
				totalBytes: 1_000_000_000,
				freePercent: 90,
				databaseBytes: 20_000_000
			},
			rosters: { ok: true, teams: 105, stale: 0, oldestAgeSeconds: 40_000, ttlSeconds: 43_200 },
			alerts: { ok: true, configured: true, lastPostOk: null, lastPostAgeSeconds: null },
			...overrides.checks
		}
	};
}

const ids = (verdict: { findings: { id: string }[] }) => verdict.findings.map((f) => f.id);

describe('quote', () => {
	it('puts foreign text on one line inside a code span it cannot close', () => {
		expect(quote('a `b`\n```c``` \r\n d')).toBe('`a ˋbˋ ˋˋˋcˋˋˋ d`');
	});

	it('cuts long text and marks the cut', () => {
		const quoted = quote('x'.repeat(500), 20);
		expect(quoted).toBe(`\`${'x'.repeat(19)}…\``);
	});

	it('is empty for nothing', () => {
		expect(quote(' \n ')).toBe('');
	});
});

describe('formatDuration', () => {
	it('reads as minutes, hours and days', () => {
		expect(formatDuration(20_000)).toBe('under a minute');
		expect(formatDuration(10 * MINUTE)).toBe('10 min');
		expect(formatDuration(3 * HOUR)).toBe('3 h');
		expect(formatDuration(3 * HOUR + 5 * MINUTE)).toBe('3 h 5 min');
		expect(formatDuration(50 * HOUR)).toBe('2 d 2 h');
	});
});

describe('evaluateHealth', () => {
	it('passes the body the health endpoint sends', () => {
		expect(evaluateHealth(json({ status: 'ok' })).findings).toEqual([]);
	});

	it('fails on any other status, naming it', () => {
		expect(evaluateHealth(json({ status: 'ok' }, 503)).findings).toEqual([
			{ id: 'origin', detail: 'HTTP 503' }
		]);
	});

	it('fails on a 200 that is not the health endpoint', () => {
		expect(ids(evaluateHealth(html(PAGE)))).toEqual(['origin']);
	});

	it('fails when nothing answered', () => {
		expect(evaluateHealth({ kind: 'error', reason: 'no answer within 10 s' }).findings).toEqual([
			{ id: 'origin', detail: 'no answer within 10 s' }
		]);
	});
});

describe('evaluateStatus', () => {
	it('finds nothing in a healthy report and reads the boot time', () => {
		const verdict = evaluateStatus(json(statusReport({ bootedAt: 1234 })));

		expect(verdict).toEqual({ findings: [], unknown: [], bootedAt: 1234 });
	});

	it('reports a check the origin says failed, and does not guess at what it measures', () => {
		const verdict = evaluateStatus(
			json(statusReport({ ok: false, checks: { write: { ok: false }, disk: { ok: false } } }))
		);

		expect(ids(verdict)).toEqual(['check:write', 'check:disk']);
		expect(verdict.unknown).toEqual(['disk-space']);
	});

	it('reports a check the origin has added since this was written', () => {
		const verdict = evaluateStatus(json(statusReport({ checks: { backups: { ok: false } } })));

		expect(ids(verdict)).toEqual(['check:backups']);
	});

	it('treats an expected check that has gone missing as failing', () => {
		const report = statusReport();
		delete (report.checks as Record<string, unknown>).write;

		expect(evaluateStatus(json(report)).findings).toEqual([
			{ id: 'check:write', detail: 'missing from the status report' }
		]);
	});

	it('never repeats a check name that is not shaped like one', () => {
		const verdict = evaluateStatus(
			json(statusReport({ ok: false, checks: { '@everyone `x`': { ok: false } } }))
		);

		expect(verdict.findings).toEqual([
			{ id: 'status', detail: 'the report says the origin is not ok' }
		]);
	});

	it('flags a volume under 15% free, and not one at it', () => {
		const disk = (freePercent: number) =>
			evaluateStatus(
				json(
					statusReport({
						checks: { disk: { ok: true, freeBytes: 104_857_600, totalBytes: 1e9, freePercent } }
					})
				)
			);

		expect(disk(15).findings).toEqual([]);
		expect(disk(14.9).findings).toEqual([
			{
				id: 'disk-space',
				detail: '14.9% of the volume is free (100 MB); the threshold is 15%'
			}
		]);
	});

	it('flags free space that was not reported, as production always has a volume', () => {
		const verdict = evaluateStatus(
			json(statusReport({ checks: { disk: { ok: true, freePercent: null } } }))
		);

		expect(verdict.findings).toEqual([{ id: 'disk-space', detail: 'free space was not reported' }]);
	});

	it('flags the oldest roster only once it is three hours past its TTL', () => {
		const rosters = (oldestAgeSeconds: number) =>
			evaluateStatus(
				json(
					statusReport({
						checks: {
							rosters: { ok: true, teams: 105, stale: 97, oldestAgeSeconds, ttlSeconds: 43_200 }
						}
					})
				)
			);

		expect(rosters(15 * 3600).findings).toEqual([]);
		const [finding] = rosters(15 * 3600 + 60).findings;
		expect(finding?.id).toBe('rosters-stale');
		expect(finding?.detail).toContain('15 h 1 min ago');
		expect(finding?.detail).toContain('97 of 105 teams are stale');
	});

	it('flags a database with no teams in it', () => {
		const verdict = evaluateStatus(
			json(
				statusReport({
					checks: {
						rosters: { ok: true, teams: 0, stale: 0, oldestAgeSeconds: null, ttlSeconds: 43_200 }
					}
				})
			)
		);

		expect(verdict.findings).toEqual([
			{ id: 'rosters-stale', detail: 'the database holds no teams' }
		]);
	});

	it('flags an app with no alert webhook', () => {
		const verdict = evaluateStatus(
			json(statusReport({ checks: { alerts: { ok: true, configured: false, lastPostOk: null } } }))
		);

		expect(ids(verdict)).toEqual(['alerts']);
	});

	it('flags a failed alert post for a day, then lets it go', () => {
		const alerts = (lastPostAgeSeconds: number) =>
			evaluateStatus(
				json(
					statusReport({
						checks: {
							alerts: { ok: true, configured: true, lastPostOk: false, lastPostAgeSeconds }
						}
					})
				)
			);

		expect(ids(alerts(3600))).toEqual(['alerts']);
		expect(ids(alerts(24 * 3600))).toEqual([]);
	});

	it('knows nothing about the machine when the report does not arrive', () => {
		const verdict = evaluateStatus(json({}, 502));

		expect(verdict.findings).toEqual([{ id: 'status', detail: 'HTTP 502' }]);
		expect(verdict.bootedAt).toBeNull();
		expect(verdict.unknown).toEqual([
			'check:',
			'disk-space',
			'rosters-stale',
			'alerts',
			'restarts'
		]);
	});

	it('fails a 200 that is not a report, including a redirect followed elsewhere', () => {
		expect(ids(evaluateStatus(html(PAGE)))).toEqual(['status']);
		expect(evaluateStatus(json({}, 308)).findings).toEqual([{ id: 'status', detail: 'HTTP 308' }]);
	});
});

describe('evaluatePage', () => {
	it("passes the app's own page", () => {
		expect(evaluatePage('site', '/', html(PAGE))).toEqual({ findings: [], unknown: [] });
	});

	it('fails an error page, quoting no more of it than a sanitised title', () => {
		const verdict = evaluatePage(
			'edge',
			'/privacy',
			html(
				'<html><head><title>Worker exceeded `limits` | numbrrs.app</title></head><body>secret body text</body></html>',
				503
			)
		);

		expect(verdict).toEqual({
			findings: [{ id: 'edge', detail: 'HTTP 503 `Worker exceeded ˋlimitsˋ | numbrrs.app`' }],
			unknown: ['beacon']
		});
	});

	it('fails a 200 that is not HTML', () => {
		expect(ids(evaluatePage('site', '/', json({ status: 'ok' })))).toEqual(['site']);
	});

	it('fails a 200 page that is not the app, such as a challenge or a parked domain', () => {
		const verdict = evaluatePage(
			'site',
			'/',
			html('<html><head><title>Just a moment...</title></head></html>')
		);

		expect(verdict.findings).toEqual([
			{ id: 'site', detail: "answered 200 with a page that is not the app's `Just a moment...`" }
		]);
	});

	it("fails a page carrying Cloudflare's analytics script", () => {
		const injected = PAGE.replace(
			'</body>',
			'<script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script></body>'
		);

		expect(ids(evaluatePage('site', '/', html(injected)))).toEqual(['beacon']);
	});

	it('fails when nothing answered', () => {
		expect(evaluatePage('site', '/', { kind: 'error', reason: 'no answer within 10 s' })).toEqual({
			findings: [{ id: 'site', detail: 'no answer within 10 s' }],
			unknown: ['beacon']
		});
	});
});

const clear: Observation = { findings: [], unknown: [], bootedAt: 1000 };
const originDown: Observation = {
	findings: [{ id: 'origin', detail: 'HTTP 503' }],
	unknown: [],
	bootedAt: 1000
};

/** Run a sequence of observations five minutes apart and collect what each said. */
function play(observations: Observation[], start: MonitorState | null = emptyState()) {
	let state = start;
	const said: string[][] = [];
	const states: MonitorState[] = [];
	observations.forEach((observation, run) => {
		const { next, notices } = advance(state, observation, T0 + run * RUN);
		said.push(
			notices.map((notice) => ('id' in notice ? `${notice.kind}:${notice.id}` : notice.kind))
		);
		states.push(next);
		state = next;
	});
	return { said, states };
}

describe('advance', () => {
	it('announces itself on the first run only', () => {
		const { said } = play([clear, clear], null);

		expect(said).toEqual([['started'], []]);
	});

	it('announces a failure on its second run in a row, once', () => {
		const { said } = play([originDown, originDown, originDown, originDown]);

		expect(said).toEqual([[], ['down:origin'], [], []]);
	});

	it('forgets a failure that did not repeat', () => {
		const { said, states } = play([originDown, clear, originDown, clear]);

		expect(said).toEqual([[], [], [], []]);
		expect(states.at(-1)?.incidents).toEqual({});
	});

	it('does not change the state on a run where nothing happened', () => {
		const { states } = play([clear, clear, originDown, originDown, originDown, originDown]);

		expect(serialize(states[1]!)).toBe(serialize(states[0]!));
		expect(serialize(states[5]!)).toBe(serialize(states[3]!));
	});

	it('announces recovery after two passing runs, with how long it was down', () => {
		let state: MonitorState | null = emptyState();
		const step = (observation: Observation, at: number) => {
			const result = advance(state, observation, at);
			state = result.next;
			return result.notices;
		};

		step(originDown, T0);
		step(originDown, T0 + RUN);
		step(originDown, T0 + 2 * RUN);
		expect(step(clear, T0 + 3 * RUN)).toEqual([]);
		expect(step(clear, T0 + 4 * RUN)).toEqual([
			{ kind: 'recovered', id: 'origin', since: T0, until: T0 + 3 * RUN }
		]);
		expect(state.incidents).toEqual({});
	});

	it('does not call a flapping check recovered', () => {
		const { said } = play([originDown, originDown, clear, originDown, clear, originDown, clear]);

		expect(said.flat()).toEqual(['down:origin']);
	});

	it('reminds after 3 hours, then 6, then daily', () => {
		let state: MonitorState | null = emptyState();
		const reminders: number[] = [];
		// Announced on the second run; hours are counted from there.
		const announcedAt = T0 + RUN;
		for (let at = T0; at <= announcedAt + 60 * HOUR; at += RUN) {
			const result = advance(state, originDown, at);
			state = result.next;
			if (result.notices.some((notice) => notice.kind === 'reminder')) {
				reminders.push((at - announcedAt) / HOUR);
			}
		}

		expect(reminders).toEqual([3, 9, 33, 57]);
	});

	it('tracks each check on its own, and reports them in one run together', () => {
		const both: Observation = {
			findings: [
				{ id: 'origin', detail: 'HTTP 503' },
				{ id: 'site', detail: 'HTTP 502' }
			],
			unknown: [],
			bootedAt: 1000
		};
		const { said } = play([both, both, originDown, originDown]);

		expect(said).toEqual([[], ['down:origin', 'down:site'], [], ['recovered:site']]);
	});

	it('neither repeats nor clears an outage it could not look at', () => {
		const diskLow: Observation = {
			findings: [{ id: 'disk-space', detail: '9% of the volume is free' }],
			unknown: [],
			bootedAt: 1000
		};
		const statusUnreadable: Observation = {
			findings: [{ id: 'status', detail: 'HTTP 502' }],
			unknown: ['check:', 'disk-space', 'rosters-stale', 'alerts', 'restarts'],
			bootedAt: null
		};
		const { said, states } = play([
			diskLow,
			diskLow,
			statusUnreadable,
			statusUnreadable,
			statusUnreadable,
			diskLow,
			clear,
			clear
		]);

		// The disk outage sits untouched through the three runs that could not see
		// it, and its two passing runs are counted only from when it could be.
		expect(said).toEqual([
			[],
			['down:disk-space'],
			[],
			['down:status'],
			[],
			[],
			['recovered:status'],
			['recovered:disk-space']
		]);
		expect(states[4]!.incidents['disk-space']).toEqual(states[1]!.incidents['disk-space']);
	});

	it('holds an unknown check by prefix too', () => {
		const writeFailing: Observation = {
			findings: [{ id: 'check:write', detail: 'the origin reports this check failing' }],
			unknown: [],
			bootedAt: 1000
		};
		const statusUnreadable: Observation = { findings: [], unknown: ['check:'], bootedAt: null };
		const { said } = play([writeFailing, writeFailing, statusUnreadable, statusUnreadable]);

		expect(said.flat()).toEqual(['down:check:write']);
	});

	it('takes one new boot time for a deploy', () => {
		const { said, states } = play([
			clear,
			{ ...clear, bootedAt: 2000 },
			{ ...clear, bootedAt: 2000 }
		]);

		expect(said.flat()).toEqual([]);
		expect(states[2]!.boot).toEqual({ at: 2000, changes: [T0 + RUN] });
	});

	it('takes three new boot times inside an hour for a restart loop', () => {
		const boots = [1000, 2000, 3000, 4000, 5000].map((bootedAt) => ({ ...clear, bootedAt }));
		const { said } = play(boots);

		// The third change makes it a finding; the run after makes it an alert.
		expect(said).toEqual([[], [], [], [], ['down:restarts']]);
	});

	it('lets a restart loop clear once the restarts are more than an hour old', () => {
		const boots = [1000, 2000, 3000, 4000, 5000].map((bootedAt) => ({ ...clear, bootedAt }));
		const settled = Array.from({ length: 13 }, () => ({ ...clear, bootedAt: 5000 }));
		const { said, states } = play([...boots, ...settled]);

		expect(said.flat()).toEqual(['down:restarts', 'recovered:restarts']);
		expect(states.at(-1)).toEqual({ v: 1, incidents: {}, boot: { at: 5000, changes: [] } });
	});

	it('does not count a first sighting of the boot time as a restart', () => {
		const { states } = play([{ ...clear, bootedAt: null }, clear]);

		expect(states[1]!.boot).toEqual({ at: 1000, changes: [] });
	});
});

describe('serialize and parseState', () => {
	it('round-trips a state, whatever order its incidents were added in', () => {
		const { states } = play([
			{
				findings: [
					{ id: 'site', detail: 'x' },
					{ id: 'origin', detail: 'y' }
				],
				unknown: [],
				bootedAt: 1000
			}
		]);
		const state = states[0]!;
		const reordered: MonitorState = {
			...state,
			incidents: { origin: state.incidents.origin!, site: state.incidents.site! }
		};

		expect(serialize(reordered)).toBe(serialize(state));
		expect(parseState(serialize(state))).toEqual(reordered);
	});

	it('reads anything else as no state at all', () => {
		expect(parseState(null)).toBeNull();
		expect(parseState('')).toBeNull();
		expect(parseState('{"v":2}')).toBeNull();
		expect(parseState('{"v":1,"incidents":{"x":"y"},"boot":{}}')).toBeNull();
	});
});

describe('formatNotices', () => {
	it('says nothing when there is nothing to say', () => {
		expect(formatNotices([], T0)).toBeNull();
	});

	it('puts everything one run has to say in one message', () => {
		const content = formatNotices(
			[
				{ kind: 'down', id: 'origin', detail: 'HTTP 503' },
				{ kind: 'down', id: 'check:write', detail: 'the origin reports this check failing' },
				{ kind: 'reminder', id: 'disk-space', detail: '9% free', since: T0 - 3 * HOUR },
				{ kind: 'recovered', id: 'site', since: T0 - 25 * MINUTE, until: T0 - 5 * MINUTE }
			],
			T0
		);

		expect(content).toBe(
			[
				'**numbrrs: 2 checks are failing**',
				'• **Origin health check**: HTTP 503',
				'• **Origin check `write`**: the origin reports this check failing',
				'',
				'**numbrrs: still failing**',
				'• **Disk space**: for 3 h. 9% free',
				'',
				'**numbrrs: recovered**',
				'• **Home page**: passing again after 20 min'
			].join('\n')
		);
	});

	it('greets with what the first run found', () => {
		expect(formatNotices([{ kind: 'started', failing: [] }], T0)).toContain(
			'Every check passed on the first run'
		);
		expect(
			formatNotices([{ kind: 'started', failing: [{ id: 'site', detail: 'HTTP 403' }] }], T0)
		).toContain('• **Home page**: HTTP 403');
	});

	it('stays under the length Discord accepts', () => {
		const many = Array.from({ length: 60 }, (_, n) => ({
			kind: 'down' as const,
			id: `check:c${n}`,
			detail: 'x'.repeat(100)
		}));

		expect(formatNotices(many, T0)!.length).toBeLessThanOrEqual(1900);
	});
});

describe('blindAlert', () => {
	const findings = [{ id: 'origin', detail: 'HTTP 503' }];

	it('speaks on the hour and the half hour', () => {
		expect(blindAlert(findings, T0)).toContain('• **Origin health check**: HTTP 503');
		expect(blindAlert(findings, T0 + 30 * MINUTE)).not.toBeNull();
		expect(blindAlert(findings, T0 + RUN)).toBeNull();
		expect(blindAlert(findings, T0 + 25 * MINUTE)).toBeNull();
	});

	it('has nothing to say when nothing is failing', () => {
		expect(blindAlert([], T0)).toBeNull();
	});
});

/**
 * The monitor with everything outside it replaced: the four URLs it asks, the
 * webhook, KV, and the pause before a retry. Each can be made to fail.
 */
function harness() {
	const site = {
		health: () => Response.json({ status: 'ok' }),
		status: () => Response.json(statusReport()),
		home: () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }),
		privacy: () => new Response(PAGE, { headers: { 'content-type': 'text/html' } }),
		webhook: () => new Response(null, { status: 204 })
	};
	const kv = { data: new Map<string, string>(), failReads: false, failWrites: false };
	const posts: { content: string; allowed_mentions: unknown }[] = [];
	const requests: { url: string; init: RequestInit }[] = [];
	const logs: Record<string, unknown>[] = [];

	const routes: Record<string, keyof typeof site> = {
		'https://numbrrs.fly.dev/api/health': 'health',
		'https://numbrrs.fly.dev/api/status': 'status',
		'https://numbrrs.app/': 'home',
		'https://numbrrs.app/privacy': 'privacy',
		[WEBHOOK]: 'webhook'
	};

	const fetch = vi.fn(async (url: string, init: RequestInit) => {
		const route = routes[url];
		if (!route) throw new Error(`unexpected request to ${url}`);
		requests.push({ url, init });
		const response = site[route]();
		if (route === 'webhook') {
			posts.push(JSON.parse(String(init.body)) as (typeof posts)[number]);
		}
		return response;
	});
	const sleep = vi.fn(async () => {});
	const store = {
		get: vi.fn(async (key: string) => {
			if (kv.failReads) throw new Error('KV GET failed: 503');
			return kv.data.get(key) ?? null;
		}),
		put: vi.fn(async (key: string, value: string) => {
			if (kv.failWrites) throw new Error('KV PUT failed: 429');
			kv.data.set(key, value);
		})
	};

	const monitor = createMonitor({ fetch, sleep, log: (entry) => logs.push(entry) });
	const env: Env = { UPTIME_STATE: store, ALERT_WEBHOOK_URL: WEBHOOK };
	let now = T0 - RUN;
	/** The next run, five minutes after the last. */
	const run = async (using: Env = env) => {
		now += RUN;
		await monitor(using, now);
	};
	const down = () => new Response('unavailable', { status: 503 });

	return { site, kv, posts, requests, logs, fetch, sleep, store, env, monitor, run, down };
}

describe('the monitor', () => {
	it('announces itself once, then stays quiet and writes nothing while all is well', async () => {
		const h = harness();

		await h.run();
		await h.run();
		await h.run();

		expect(h.posts).toHaveLength(1);
		expect(h.posts[0]!.content).toContain('numbrrs uptime monitor started');
		expect(h.store.put).toHaveBeenCalledTimes(1);
	});

	it('asks as a named monitor the bot filter excludes, and follows no redirect', async () => {
		const h = harness();

		await h.run();

		const probes = h.requests.filter(({ url }) => url !== WEBHOOK);
		expect(probes.map(({ url }) => url).sort()).toEqual([
			'https://numbrrs.app/',
			'https://numbrrs.app/privacy',
			'https://numbrrs.fly.dev/api/health',
			'https://numbrrs.fly.dev/api/status'
		]);
		for (const { init } of probes) {
			const headers = init.headers as Record<string, string>;
			expect(headers['user-agent']).toBe(USER_AGENT);
			expect(headers['accept-language']).toBe('en');
			expect(init.redirect).toBe('manual');
			expect(init.signal).toBeInstanceOf(AbortSignal);
		}
		const home = probes.find(({ url }) => url === 'https://numbrrs.app/')!;
		expect((home.init.headers as Record<string, string>).accept).toBe('text/html');
	});

	it("is a bot by the app's own filter, so its page requests are not counted as visits", async () => {
		// Through a variable, so the Worker's type-check does not follow the import
		// into a module written for Node.
		const telemetry = '../src/lib/server/telemetry';
		const { isBot } = (await import(telemetry)) as { isBot(userAgent: string): boolean };

		expect(isBot(USER_AGENT)).toBe(true);
	});

	it('posts once when the origin goes down, and once when it comes back', async () => {
		const h = harness();
		await h.run();
		h.posts.length = 0;

		h.site.health = h.down;
		await h.run();
		expect(h.posts).toHaveLength(0);
		await h.run();
		expect(h.posts).toHaveLength(1);
		expect(h.posts[0]!.content).toBe(
			'**numbrrs: a check is failing**\n• **Origin health check**: HTTP 503'
		);

		const writes = h.store.put.mock.calls.length;
		await h.run();
		await h.run();
		expect(h.posts).toHaveLength(1);
		expect(h.store.put).toHaveBeenCalledTimes(writes);

		h.site.health = () => Response.json({ status: 'ok' });
		await h.run();
		expect(h.posts).toHaveLength(1);
		await h.run();
		expect(h.posts).toHaveLength(2);
		expect(h.posts[1]!.content).toBe(
			'**numbrrs: recovered**\n• **Origin health check**: passing again after 20 min'
		);
	});

	it('tries a failed request once more before believing it', async () => {
		const h = harness();
		let calls = 0;
		h.site.health = () => {
			calls += 1;
			return calls % 2 === 1 ? h.down() : Response.json({ status: 'ok' });
		};

		await h.run();
		await h.run();
		await h.run();

		expect(h.sleep).toHaveBeenCalledTimes(3);
		expect(h.posts).toHaveLength(1);
		expect(h.posts[0]!.content).toContain('Every check passed');
	});

	it('reports a request that threw, without the retry hiding it', async () => {
		const h = harness();
		await h.run();
		h.site.home = () => {
			throw new TypeError('internal error; reference = abc`123');
		};

		await h.run();
		await h.run();

		expect(h.posts.at(-1)!.content).toBe(
			'**numbrrs: a check is failing**\n• **Home page**: the request failed `internal error; reference = abcˋ123`'
		);
	});

	it('reports a timeout as one', async () => {
		const h = harness();
		await h.run();
		h.site.privacy = () => {
			throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
		};

		await h.run();
		await h.run();

		expect(h.posts.at(-1)!.content).toContain(
			'• **Privacy page, through the cache Worker**: no answer within 10 s'
		);
	});

	it('posts nothing that can ping, and nothing of a response body but its title', async () => {
		const h = harness();
		await h.run();
		h.site.home = () =>
			new Response(
				'<title>@everyone ```oops``` [x](https://evil.example)</title><p>internal detail</p>',
				{ status: 500, headers: { 'content-type': 'text/html' } }
			);

		await h.run();
		await h.run();

		const post = h.posts.at(-1)!;
		expect(post.allowed_mentions).toEqual({ parse: [] });
		expect(post.content).toBe(
			'**numbrrs: a check is failing**\n• **Home page**: HTTP 500 `@everyone ˋˋˋoopsˋˋˋ [x](https://evil.example)`'
		);
		expect(post.content).not.toContain('internal detail');
	});

	it('reports thresholds read from the status report', async () => {
		const h = harness();
		await h.run();
		h.site.status = () =>
			Response.json(
				statusReport({
					checks: { disk: { ok: true, freeBytes: 52_428_800, totalBytes: 1e9, freePercent: 5 } }
				})
			);

		await h.run();
		await h.run();

		expect(h.posts.at(-1)!.content).toContain(
			'• **Disk space**: 5% of the volume is free (50 MB); the threshold is 15%'
		);
	});

	it('tries again next run when Discord did not take the message', async () => {
		const h = harness();
		await h.run();
		h.site.health = h.down;
		await h.run();
		const before = h.kv.data.get('state');

		h.site.webhook = () => new Response('rate limited', { status: 429 });
		await h.run();
		expect(h.kv.data.get('state')).toBe(before);

		// `posts` holds every attempt, so the refused one and the one that landed.
		h.site.webhook = () => new Response(null, { status: 204 });
		await h.run();
		expect(h.posts.filter((post) => post.content.includes('a check is failing'))).toHaveLength(2);
		await h.run();
		expect(h.posts.filter((post) => post.content.includes('a check is failing'))).toHaveLength(2);
	});

	it('keeps the webhook address out of the logs, even when the error quotes it', async () => {
		const h = harness();
		h.site.webhook = () => {
			throw new Error(`connect failed for ${WEBHOOK}`);
		};

		await h.run();

		const logged = JSON.stringify(h.logs);
		expect(logged).toContain('connect failed for <webhook>');
		expect(logged).not.toContain('secret-token');
	});

	it('logs what it would have said when no webhook is set, and asks again next run', async () => {
		const h = harness();
		const env: Env = { UPTIME_STATE: h.store };

		await h.run(env);
		await h.run(env);

		expect(h.posts).toHaveLength(0);
		expect(h.store.put).not.toHaveBeenCalled();
		const failures = h.logs.filter((entry) => entry.event === 'post');
		expect(failures).toHaveLength(2);
		expect(failures[0]).toMatchObject({ ok: false, detail: 'ALERT_WEBHOOK_URL is not set' });
		expect(String(failures[0]!.content)).toContain('numbrrs uptime monitor started');
	});

	it('does nothing at all while the silence key exists', async () => {
		const h = harness();
		h.kv.data.set('silence', '1');
		h.site.health = h.down;

		await h.run();
		await h.run();
		await h.run();

		expect(h.fetch).not.toHaveBeenCalled();
		expect(h.store.put).not.toHaveBeenCalled();

		h.kv.data.delete('silence');
		await h.run();
		expect(h.fetch).toHaveBeenCalled();
	});

	describe('without Workers KV', () => {
		it('does not announce itself on every run', async () => {
			const h = harness();
			h.kv.failReads = true;
			h.kv.failWrites = true;

			await h.run();
			await h.run();

			expect(h.posts).toHaveLength(0);
		});

		it('still alerts, from memory, when the isolate lives on between runs', async () => {
			const h = harness();
			h.kv.failReads = true;
			h.kv.failWrites = true;
			await h.run();

			h.site.health = h.down;
			await h.run();
			await h.run();

			expect(h.posts.map((post) => post.content)).toEqual([
				'**numbrrs: a check is failing**\n• **Origin health check**: HTTP 503'
			]);
		});

		it('still alerts, on the half hour, when each run starts with no memory', async () => {
			const said: string[] = [];
			// A new monitor per run is a new isolate: nothing carried over.
			for (let run = 0; run < 7; run += 1) {
				const h = harness();
				h.kv.failReads = true;
				h.kv.failWrites = true;
				h.site.health = h.down;
				await h.monitor(h.env, T0 + run * RUN);
				said.push(...h.posts.map((post) => post.content));
			}

			// Runs at :00 and :30 of the seven.
			expect(said).toHaveLength(2);
			expect(said[0]).toContain('checks are failing, and the monitor cannot keep its state');
			expect(said[0]).toContain('• **Origin health check**: HTTP 503');
		});

		it('alerts the same way when the binding is missing altogether', async () => {
			const h = harness();
			h.site.health = h.down;

			await h.run({ ALERT_WEBHOOK_URL: WEBHOOK });

			expect(h.posts).toHaveLength(1);
			expect(h.posts[0]!.content).toContain('the monitor cannot keep its state');
		});

		it('carries on from memory when KV reads but will not take a write', async () => {
			const h = harness();
			await h.run();
			h.posts.length = 0;
			h.kv.failWrites = true;
			h.site.health = h.down;

			// KV still holds the state from before the outage, so without the copy
			// in memory every run would be the first failing one.
			await h.run();
			await h.run();
			expect(h.posts.map((post) => post.content)).toEqual([
				'**numbrrs: a check is failing**\n• **Origin health check**: HTTP 503'
			]);

			// And the write is tried again until it lands, changed or not.
			h.kv.failWrites = false;
			await h.run();
			expect(parseState(h.kv.data.get('state') ?? null)?.incidents.origin?.announcedAt).toBe(
				T0 + 2 * RUN
			);
			expect(h.posts).toHaveLength(1);
		});
	});

	it('says so, at intervals, when the monitor itself throws', async () => {
		const h = harness();
		await h.run();
		h.posts.length = 0;
		h.site.health = h.down;
		h.sleep.mockRejectedValue(new Error('boom `x`'));

		// T0 + 5 min … T0 + 30 min: only the last is on the half hour.
		for (let run = 0; run < 6; run += 1) await h.run();

		expect(h.posts.map((post) => post.content)).toEqual([
			expect.stringContaining('**numbrrs: the uptime monitor itself failed** `boom ˋxˋ`')
		]);
	});
});
