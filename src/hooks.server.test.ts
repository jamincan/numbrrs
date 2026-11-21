import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	NEGOTIATED_VARY,
	PAGE_CACHE,
	PAGE_RATE_LIMIT,
	SECURITY_HEADERS
} from '#lib/server/request-policy.ts';

/**
 * hooks.server.ts boots the database and the sweeps as it is imported, and
 * reads `dev` and the environment as it handles each request. All of that is
 * replaced here, so what is under test is the wiring: which request reaches
 * `resolve`, which is answered early, and what every response carries.
 *
 * The rules themselves are tested exhaustively in request-policy.test.ts.
 */
const world = vi.hoisted(() => ({
	dev: false,
	building: false,
	adminDirect: false,
	adminToken: undefined as string | undefined
}));

// Created once and handed out by the factories below, so they survive the
// vi.resetModules() the boot tests use to import the hooks afresh.
const mocks = vi.hoisted(() => ({
	bootstrap: vi.fn(),
	closeDb: vi.fn(),
	startSweeps: vi.fn(),
	installProcessGuards: vi.fn(),
	recordEvent: vi.fn(),
	reportError: vi.fn(() => 'fingerprint-1'),
	verifyAccessToken: vi.fn()
}));

vi.mock('$app/env', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/env')>()),
	get dev() {
		return world.dev;
	},
	get building() {
		return world.building;
	}
}));
vi.mock('$app/env/private', () => ({
	get ADMIN_DIRECT() {
		return world.adminDirect;
	},
	get ADMIN_TOKEN() {
		return world.adminToken;
	},
	ALERT_WEBHOOK_URL: undefined,
	EDGE_TOKEN: undefined,
	DATABASE_URL: ':memory:'
}));
vi.mock('#lib/server/db/index.ts', () => ({
	bootstrap: mocks.bootstrap,
	closeDb: mocks.closeDb
}));
vi.mock('#lib/server/leagues/index.ts', () => ({ startSweeps: mocks.startSweeps }));
// Process-wide: the real one attaches handlers that end the process, which in a
// test would be the worker running every other test in this file.
vi.mock('#lib/server/process-guards.ts', () => ({
	installProcessGuards: mocks.installProcessGuards
}));
vi.mock('#lib/server/analytics.ts', () => ({ recordEvent: mocks.recordEvent }));
vi.mock('#lib/server/alerts.ts', () => ({ reportError: mocks.reportError }));
vi.mock('#lib/server/cloudflare-access.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/cloudflare-access.ts')>()),
	verifyAccessToken: mocks.verifyAccessToken
}));

const VALID_TOKEN = 'a-token-access-would-issue';

const HOME_ROUTE = '/[[lang=locale]]';
const TEAM_ROUTE = '/[[lang=locale]]/game/[league]/[team]';

type Hooks = typeof import('./hooks.server.ts');
type HandleError = Hooks['handleError'];

let hooks: Hooks;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
	hooks = await import('./hooks.server.ts');
});

beforeEach(() => {
	Object.assign(world, { dev: false, building: false, adminDirect: false, adminToken: undefined });
	vi.clearAllMocks();
	mocks.reportError.mockReturnValue('fingerprint-1');
	mocks.verifyAccessToken.mockImplementation((token: string | null | undefined) =>
		Promise.resolve(
			token === VALID_TOKEN
				? { ok: true }
				: { ok: false, reason: token ? 'signature verification failed' : 'no Access token' }
		)
	);
	// Refusals and boot warnings are logged; the tests assert on them rather
	// than letting them into the output.
	warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	warn.mockRestore();
});

interface Incoming {
	/** The route SvelteKit matched, which it does on the decoded path. */
	routeId?: string | null;
	method?: string;
	headers?: Record<string, string>;
	cookies?: Record<string, string>;
	params?: Record<string, string>;
	locals?: Partial<App.Locals>;
	/**
	 * What the socket reports. Loopback unless a test says otherwise, as it is
	 * for a server run locally; on Fly the `fly-client-ip` header outranks it.
	 */
	clientAddress?: () => string;
}

/**
 * The event SvelteKit hands `handle`. Two things about it matter for these
 * tests and are easy to get wrong: `url.pathname` is exactly what the client
 * sent, percent-escapes and all, while `route.id` comes from matching the
 * decoded path — so `/%61dmin` arrives with route id `/admin`. And a
 * `/__data.json` request arrives with that suffix already stripped from the URL.
 */
function eventFor(url: string, incoming: Incoming = {}): RequestEvent {
	const { routeId = null, method = 'GET', headers = {}, cookies = {}, params = {} } = incoming;
	return {
		url: new URL(url),
		request: new Request(url, { method, headers }),
		route: { id: routeId },
		params,
		locals: { ...incoming.locals },
		cookies: { get: (name: string) => cookies[name] },
		getClientAddress: incoming.clientAddress ?? (() => '127.0.0.1')
	} as unknown as RequestEvent;
}

/** A `resolve` that answers like SvelteKit rendering a page. */
function resolving(status = 200, headers: Record<string, string> = {}) {
	return vi.fn(
		async (
			_event: RequestEvent,
			opts?: { transformPageChunk?: (input: { html: string; done: boolean }) => unknown }
		) => {
			const html = await opts?.transformPageChunk?.({ html: '<html lang="%lang%">', done: true });
			return new Response(String(html ?? ''), {
				status,
				headers: { 'content-type': 'text/html', ...headers }
			});
		}
	);
}

function expectSecurityHeaders(response: Response): void {
	for (const [name, value] of SECURITY_HEADERS) {
		expect(response.headers.get(name), name).toBe(value);
	}
}

describe('the Cloudflare Access gate on /admin', () => {
	const refused: Array<[label: string, url: string, incoming: Incoming]> = [
		['GET /admin', 'https://numbrrs.app/admin', { routeId: '/admin' }],
		// SvelteKit strips the suffix before `handle` sees the URL.
		['GET /admin/__data.json', 'https://numbrrs.app/admin', { routeId: '/admin' }],
		['GET /%61dmin', 'https://numbrrs.app/%61dmin', { routeId: '/admin' }],
		['GET /a%64min/__data.json', 'https://numbrrs.app/a%64min', { routeId: '/admin' }],
		[
			'POST /admin?/resync',
			'https://numbrrs.app/admin?/resync',
			{ routeId: '/admin', method: 'POST' }
		],
		[
			'POST /%61dmin?/login',
			'https://numbrrs.app/%61dmin?/login',
			{ routeId: '/admin', method: 'POST' }
		],
		[
			'GET /admin/whatever (no such route)',
			'https://numbrrs.app/admin/whatever',
			{ routeId: null }
		],
		[
			'GET /%61dmin/whatever (no such route)',
			'https://numbrrs.app/%61dmin/whatever',
			{ routeId: null }
		]
	];

	it.each(refused)(
		'refuses %s without a token, and never runs the route',
		async (_l, url, incoming) => {
			const resolve = resolving();

			const response = await hooks.handle({ event: eventFor(url, incoming), resolve });

			expect(response.status).toBe(403);
			expect(await response.text()).toBe('Forbidden');
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expectSecurityHeaders(response);
			expect(resolve).not.toHaveBeenCalled();
			expect(mocks.recordEvent).not.toHaveBeenCalled();
		}
	);

	it.each(refused)('refuses %s with a token Access did not issue', async (_l, url, incoming) => {
		const resolve = resolving();
		const event = eventFor(url, {
			...incoming,
			headers: { 'cf-access-jwt-assertion': 'forged' },
			cookies: { CF_Authorization: 'also-forged' }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('logs who was refused and why', async () => {
		const event = eventFor('https://numbrrs.app/%61dmin', {
			routeId: '/admin',
			headers: { 'fly-client-ip': '198.51.100.7' }
		});

		await hooks.handle({ event, resolve: resolving() });

		expect(warn).toHaveBeenCalledWith(
			'[admin] refused GET /%61dmin from 198.51.100.7: no Access token'
		);
	});

	it('lets a request with a valid header through', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/admin', {
			routeId: '/admin',
			headers: { 'cf-access-jwt-assertion': VALID_TOKEN }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(mocks.verifyAccessToken).toHaveBeenCalledWith(VALID_TOKEN);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(warn).not.toHaveBeenCalled();
	});

	it('falls back to the cookie when the header is absent', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/admin', {
			routeId: '/admin',
			cookies: { CF_Authorization: VALID_TOKEN }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(mocks.verifyAccessToken).toHaveBeenCalledWith(VALID_TOKEN);
	});

	it('does not let a good cookie rescue a bad header', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/admin', {
			routeId: '/admin',
			headers: { 'cf-access-jwt-assertion': 'forged' },
			cookies: { CF_Authorization: VALID_TOKEN }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('is skipped entirely when ADMIN_DIRECT is set', async () => {
		world.adminDirect = true;
		const resolve = resolving();

		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/admin', { routeId: '/admin' }),
			resolve
		});

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
		expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
		// Skipping Access does not make the page cacheable.
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('is skipped in dev', async () => {
		world.dev = true;
		const resolve = resolving();

		const response = await hooks.handle({
			event: eventFor('http://localhost:5173/admin', { routeId: '/admin' }),
			resolve
		});

		expect(response.status).toBe(200);
		expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
	});

	it.each([
		['/administrator', null],
		['/%61dministrator', null],
		['/game/admin', null],
		['/', HOME_ROUTE],
		['/api/health', '/api/health']
	])('does not apply to %s', async (path, routeId) => {
		const resolve = resolving();

		await hooks.handle({ event: eventFor(`https://numbrrs.app${path}`, { routeId }), resolve });

		expect(resolve).toHaveBeenCalledTimes(1);
		expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
	});
});

describe('the redirect from retired hostnames', () => {
	it('is permanent and keeps the path and query', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.ca/fr/game/nhl/TOR?mode=hard&x=1', {
			routeId: TEAM_ROUTE,
			params: { lang: 'fr' }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(301);
		expect(response.headers.get('location')).toBe(
			'https://numbrrs.app/fr/game/nhl/TOR?mode=hard&x=1'
		);
		expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
		expectSecurityHeaders(response);
		expect(resolve).not.toHaveBeenCalled();
	});

	it.each(['//example.com/', '/\\example.com/', '//example.com:443/x?y=1', '//a:b/x'])(
		'cannot be pointed at another site by the path %j',
		async (path) => {
			const response = await hooks.handle({
				event: eventFor(`https://www.numbrrs.app${path}`),
				resolve: resolving()
			});

			expect(response.status).toBe(301);
			expect(new URL(response.headers.get('location') ?? '').origin).toBe('https://numbrrs.app');
		}
	);

	it('comes before everything else, the Access gate included', async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.ca/admin', { routeId: '/admin' }),
			resolve: resolving()
		});

		expect(response.status).toBe(301);
		expect(response.headers.get('location')).toBe('https://numbrrs.app/admin');
		expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
	});

	it('leaves the canonical host alone', async () => {
		const resolve = resolving();
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/game/nhl/TOR', { routeId: TEAM_ROUTE }),
			resolve
		});
		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
	});
});

describe('the redirect from the Fly hostname', () => {
	it('sends a page to the canonical host, keeping the path and query', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.fly.dev/fr/game/nhl/TOR?mode=hard&x=1', {
			routeId: TEAM_ROUTE,
			params: { lang: 'fr' }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe(
			'https://numbrrs.app/fr/game/nhl/TOR?mode=hard&x=1'
		);
		// Stored, it would still be followed while the switch below is on, to a
		// host that is down.
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expectSecurityHeaders(response);
		expect(resolve).not.toHaveBeenCalled();
		expect(mocks.recordEvent).not.toHaveBeenCalled();
	});

	it('comes before the French redirect, so nobody is sent to /fr on the wrong host', async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.fly.dev/game/nhl/TOR', {
				routeId: TEAM_ROUTE,
				headers: { 'accept-language': 'fr-CA,fr;q=0.9' }
			}),
			resolve: resolving()
		});

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe('https://numbrrs.app/game/nhl/TOR');
	});

	it.each([
		['GET /admin', 'https://numbrrs.fly.dev/admin', 'GET'],
		['GET /%61dmin', 'https://numbrrs.fly.dev/%61dmin', 'GET'],
		['POST /admin?/login', 'https://numbrrs.fly.dev/admin?/login', 'POST']
	])('sends %s to where Access guards it instead of refusing it', async (_label, url, method) => {
		const resolve = resolving();

		const response = await hooks.handle({
			event: eventFor(url, { routeId: '/admin', method }),
			resolve
		});

		expect(response.status).toBe(308);
		expect(response.headers.get('location')).toBe(url.replace('numbrrs.fly.dev', 'numbrrs.app'));
		expect(resolve).not.toHaveBeenCalled();
		expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});

	it('keeps answering the health check there', async () => {
		const resolve = resolving();

		const response = await hooks.handle({
			event: eventFor('https://numbrrs.fly.dev/api/health', { routeId: '/api/health' }),
			resolve
		});

		expect(response.status).toBe(200);
		expect(resolve).toHaveBeenCalledTimes(1);
	});

	it.each(['//example.com/', '/\\example.com/', '//example.com:443/x?y=1', '//a:b/x'])(
		'cannot be pointed at another site by the path %j',
		async (path) => {
			const response = await hooks.handle({
				event: eventFor(`https://numbrrs.fly.dev${path}`),
				resolve: resolving()
			});

			expect(response.status).toBe(308);
			expect(new URL(response.headers.get('location') ?? '').origin).toBe('https://numbrrs.app');
		}
	);

	describe('while ADMIN_DIRECT is on', () => {
		beforeEach(() => {
			world.adminDirect = true;
		});

		it('serves pages there directly', async () => {
			const resolve = resolving();
			const event = eventFor('https://numbrrs.fly.dev/game/nhl/TOR', { routeId: TEAM_ROUTE });

			const response = await hooks.handle({ event, resolve });

			expect(response.status).toBe(200);
			expect(response.headers.has('location')).toBe(false);
			expect(resolve).toHaveBeenCalledTimes(1);
		});

		it('serves /admin there with no Access token, leaving it to the token login', async () => {
			const resolve = resolving();

			const response = await hooks.handle({
				event: eventFor('https://numbrrs.fly.dev/admin', { routeId: '/admin' }),
				resolve
			});

			expect(response.status).toBe(200);
			expect(resolve).toHaveBeenCalledTimes(1);
			expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
			expect(response.headers.get('cache-control')).toBe('private, no-store');
		});

		it('still redirects the retired hostnames', async () => {
			const response = await hooks.handle({
				event: eventFor('https://numbrrs.ca/game/nhl/TOR', { routeId: TEAM_ROUTE }),
				resolve: resolving()
			});

			expect(response.status).toBe(301);
		});
	});

	it('does not get a direct request that names the canonical host past the Access check', async () => {
		// A connection made straight to Fly can put any host it likes in the
		// request. Naming the canonical one avoids the redirect, and must then meet
		// the same refusal as before there was a redirect to avoid.
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/admin', {
			routeId: '/admin',
			// Not one of Cloudflare's addresses: this did not come through the edge.
			headers: { 'fly-client-ip': '198.51.100.7' }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(403);
		expect(resolve).not.toHaveBeenCalled();
	});
});

describe('the per-address request limit', () => {
	const LIMIT = PAGE_RATE_LIMIT.limit;

	// The counts live in the module and outlast a test, so each test uses an
	// address of its own.
	let nextAddress = 0;
	const freshAddress = () => `203.0.113.${++nextAddress}`;

	const pageFrom = (ip: string, incoming: Incoming = {}) =>
		eventFor('https://numbrrs.app/game/nhl/TOR', {
			routeId: TEAM_ROUTE,
			...incoming,
			headers: { 'fly-client-ip': ip, ...incoming.headers }
		});

	/** Sends `count` requests and returns the status of each. */
	async function statuses(count: number, event: () => RequestEvent): Promise<number[]> {
		const seen: number[] = [];
		for (let i = 0; i < count; i++) {
			seen.push((await hooks.handle({ event: event(), resolve: resolving() })).status);
		}
		return seen;
	}

	it('serves an address its allowance, then answers 429 without running the route', async () => {
		const ip = freshAddress();
		expect(new Set(await statuses(LIMIT, () => pageFrom(ip)))).toEqual(new Set([200]));
		mocks.recordEvent.mockClear();
		const resolve = resolving();

		const response = await hooks.handle({ event: pageFrom(ip), resolve });

		expect(response.status).toBe(429);
		expect(await response.text()).toBe('Too Many Requests');
		expect(Number(response.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
		expect(Number(response.headers.get('retry-after'))).toBeLessThanOrEqual(60);
		// Nothing a cache may keep: the Worker stores only a 200, and this says
		// so to any other cache between here and the visitor.
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expectSecurityHeaders(response);
		expect(resolve).not.toHaveBeenCalled();
		expect(mocks.recordEvent).not.toHaveBeenCalled();
	});

	it('logs one line for an address over the limit, and alerts nobody', async () => {
		const ip = freshAddress();
		await statuses(LIMIT, () => pageFrom(ip));

		expect(new Set(await statuses(25, () => pageFrom(ip)))).toEqual(new Set([429]));

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(
			`[rate-limit] ${ip} is over ${LIMIT} requests a minute, answering 429: GET /game/nhl/TOR`
		);
		expect(mocks.reportError).not.toHaveBeenCalled();
	});

	it('counts each address separately', async () => {
		const [busy, quiet] = [freshAddress(), freshAddress()];
		await statuses(LIMIT + 5, () => pageFrom(busy));

		const response = await hooks.handle({ event: pageFrom(quiet), resolve: resolving() });

		expect(response.status).toBe(200);
	});

	it('lets the address back in once its requests have left the window', async () => {
		const ip = freshAddress();
		vi.useFakeTimers({ toFake: ['Date'] });
		try {
			vi.setSystemTime(new Date('2026-11-21T12:00:00Z'));
			await statuses(LIMIT, () => pageFrom(ip));
			vi.setSystemTime(new Date('2026-11-21T12:00:20Z'));
			const refused = await hooks.handle({ event: pageFrom(ip), resolve: resolving() });

			expect(refused.status).toBe(429);
			expect(refused.headers.get('retry-after')).toBe('40');

			vi.setSystemTime(new Date('2026-11-21T12:01:00Z'));
			const served = await hooks.handle({ event: pageFrom(ip), resolve: resolving() });

			expect(served.status).toBe(200);
		} finally {
			vi.useRealTimers();
		}
	});

	it('counts a visitor behind Cloudflare by their own address, not the edge it came through', async () => {
		// Two visitors arriving through the same Cloudflare address.
		const edge = '172.68.1.1';
		const [busy, quiet] = [freshAddress(), freshAddress()];
		const through = (visitor: string) => () =>
			pageFrom(edge, { headers: { 'cf-connecting-ip': visitor } });
		await statuses(LIMIT, through(busy));

		expect(await statuses(1, through(busy))).toEqual([429]);
		expect(await statuses(1, through(quiet))).toEqual([200]);
	});

	it('counts pages that do not exist as well, which cost a render each', async () => {
		const ip = freshAddress();
		const missing = () =>
			eventFor('https://numbrrs.app/wp-login.php', { headers: { 'fly-client-ip': ip } });
		for (let i = 0; i < LIMIT; i++) {
			await hooks.handle({ event: missing(), resolve: resolving(404) });
		}

		const response = await hooks.handle({ event: missing(), resolve: resolving(404) });

		expect(response.status).toBe(429);
	});

	it.each([
		['/api/health', '/api/health', 'GET'],
		['/api/status', '/api/status', 'GET'],
		['/api/hit', '/api/hit', 'POST'],
		['/api/client-error', '/api/client-error', 'POST']
	])(
		'never limits %s, even for an address that is over the limit',
		async (path, routeId, method) => {
			const ip = freshAddress();
			await statuses(LIMIT + 1, () => pageFrom(ip));

			const exempt = await statuses(LIMIT + 10, () =>
				eventFor(`https://numbrrs.app${path}`, {
					routeId,
					method,
					headers: { 'fly-client-ip': ip }
				})
			);

			expect(new Set(exempt)).toEqual(new Set([200]));
		}
	);

	it('never limits /admin, which has a limit of its own', async () => {
		const ip = freshAddress();
		await statuses(LIMIT + 1, () => pageFrom(ip));

		const admin = await statuses(LIMIT + 10, () =>
			eventFor('https://numbrrs.app/admin', {
				routeId: '/admin',
				headers: { 'fly-client-ip': ip, 'cf-access-jwt-assertion': VALID_TOKEN }
			})
		);

		expect(new Set(admin)).toEqual(new Set([200]));
	});

	it('does not spend the allowance on requests the health check makes', async () => {
		const ip = freshAddress();
		await statuses(LIMIT * 2, () =>
			eventFor('https://numbrrs.app/api/health', {
				routeId: '/api/health',
				headers: { 'fly-client-ip': ip }
			})
		);

		expect(await statuses(LIMIT, () => pageFrom(ip))).not.toContain(429);
	});

	it.each([
		['127.0.0.1', '127.0.0.1'],
		['::1', '::1'],
		['::ffff:127.0.0.1', '::ffff:127.0.0.1']
	])(
		'never limits the server talking to itself, as dev and the e2e suite do: %s',
		async (_label, address) => {
			// No Fly header: this is a server on a laptop, and the address is the
			// socket's.
			const local = () =>
				eventFor('http://localhost:4729/game/nhl/TOR', {
					routeId: TEAM_ROUTE,
					clientAddress: () => address
				});

			expect(new Set(await statuses(LIMIT * 3, local))).toEqual(new Set([200]));
			expect(warn).not.toHaveBeenCalled();
		}
	);

	it('does not pool requests whose address cannot be determined', async () => {
		// One key for all of them would let the first burst lock out the rest.
		const anonymous = () =>
			eventFor('https://numbrrs.app/game/nhl/TOR', {
				routeId: TEAM_ROUTE,
				clientAddress: () => {
					throw new Error('no address for this request');
				}
			});

		expect(new Set(await statuses(LIMIT * 3, anonymous))).toEqual(new Set([200]));
		expect(warn).not.toHaveBeenCalled();
	});

	it('still limits a direct request on the Fly hostname while ADMIN_DIRECT serves it', async () => {
		world.adminDirect = true;
		const ip = freshAddress();
		const direct = () =>
			eventFor('https://numbrrs.fly.dev/game/nhl/TOR', {
				routeId: TEAM_ROUTE,
				headers: { 'fly-client-ip': ip }
			});

		const seen = await statuses(LIMIT + 1, direct);

		expect(seen.slice(0, LIMIT)).not.toContain(429);
		expect(seen[LIMIT]).toBe(429);
	});
});

describe('the redirect to French', () => {
	const french = { 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.5' };

	it('sends a French-speaking visitor on an unprefixed page to /fr', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/game/nhl/TOR?mode=hard', {
			routeId: TEAM_ROUTE,
			headers: french
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(302);
		expect(response.headers.get('location')).toBe('/fr/game/nhl/TOR?mode=hard');
		expect(response.headers.get('vary')).toBe(NEGOTIATED_VARY);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expectSecurityHeaders(response);
		expect(resolve).not.toHaveBeenCalled();
		expect(mocks.recordEvent).not.toHaveBeenCalled();
	});

	it('sends the home page to /fr', async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/', { routeId: HOME_ROUTE, headers: french }),
			resolve: resolving()
		});

		expect(response.headers.get('location')).toBe('/fr');
	});

	it('leaves someone who chose English where they are, and says the answer varied', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/game/nhl/TOR', {
			routeId: TEAM_ROUTE,
			headers: french,
			cookies: { numbrrs_locale: 'en' }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(200);
		expect(response.headers.get('vary')).toBe(NEGOTIATED_VARY);
		expect(await response.text()).toBe('<html lang="en">');
		expect(event.locals.locale).toBe('en');
	});

	it('adds to a Vary the response already has rather than replacing it', async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/privacy', { routeId: '/[[lang=locale]]/privacy' }),
			resolve: resolving(200, { vary: 'Accept-Encoding' })
		});

		expect(response.headers.get('vary')).toBe(`Accept-Encoding, ${NEGOTIATED_VARY}`);
	});

	it('serves a /fr URL in French with nothing to negotiate', async () => {
		const resolve = resolving();
		const event = eventFor('https://numbrrs.app/fr/game/nhl/TOR', {
			routeId: TEAM_ROUTE,
			params: { lang: 'fr' },
			headers: { 'accept-language': 'en' }
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.status).toBe(200);
		expect(response.headers.has('vary')).toBe(false);
		expect(await response.text()).toBe('<html lang="fr">');
		expect(event.locals.locale).toBe('fr');
	});

	it('takes the locale from the path when the URL matched no route', async () => {
		const event = eventFor('https://numbrrs.app/fr/nonexistent', { headers: french });

		const response = await hooks.handle({ event, resolve: resolving(404) });

		expect(response.status).toBe(404);
		expect(event.locals.locale).toBe('fr');
		expect(await response.text()).toBe('<html lang="fr">');
	});

	it('never redirects an API route', async () => {
		const resolve = resolving();

		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/api/health', {
				routeId: '/api/health',
				headers: french
			}),
			resolve
		});

		expect(response.status).toBe(200);
		expect(response.headers.has('vary')).toBe(false);
	});
});

describe('caching', () => {
	const teamPage = (incoming: Incoming = {}) =>
		eventFor('https://numbrrs.app/game/nhl/TOR', { routeId: TEAM_ROUTE, ...incoming });

	it('offers a team page to shared caches', async () => {
		const response = await hooks.handle({ event: teamPage(), resolve: resolving() });

		expect(response.headers.get('cache-control')).toBe(PAGE_CACHE);
	});

	it("overrides the no-store SvelteKit puts on a page's data", async () => {
		const response = await hooks.handle({
			event: teamPage(),
			resolve: resolving(200, { 'cache-control': 'private, no-store' })
		});

		expect(response.headers.get('cache-control')).toBe(PAGE_CACHE);
	});

	it.each([404, 500, 301])('does not offer a %i to shared caches', async (status) => {
		const response = await hooks.handle({ event: teamPage(), resolve: resolving(status) });

		expect(response.headers.get('cache-control')).toBeNull();
	});

	it('offers the home page to shared caches like any other page', async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/', { routeId: HOME_ROUTE }),
			resolve: resolving()
		});

		expect(response.headers.get('cache-control')).toBe(PAGE_CACHE);
	});

	it('honours a load that marked its response uncacheable', async () => {
		const event = teamPage();
		const resolve = vi.fn(async (resolved: RequestEvent) => {
			// Set during the load, which is to say during `resolve`.
			resolved.locals.uncacheable = true;
			return new Response('<html>');
		});

		const response = await hooks.handle({ event, resolve });

		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('leaves a response that sets a cookie out of shared caches', async () => {
		const response = await hooks.handle({
			event: teamPage(),
			resolve: resolving(200, { 'set-cookie': 'numbrrs_locale=en; Path=/' })
		});

		expect(response.headers.get('cache-control')).toBeNull();
	});

	it("leaves an endpoint's own policy alone", async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/sitemap.xml', { routeId: '/sitemap.xml' }),
			resolve: resolving(200, { 'cache-control': 'public, max-age=3600' })
		});

		expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
	});
});

describe('every response', () => {
	it.each([
		['a page', 'https://numbrrs.app/game/nhl/TOR', TEAM_ROUTE, 200],
		['a 404', 'https://numbrrs.app/nope', null, 404],
		['an API route', 'https://numbrrs.app/api/health', '/api/health', 200]
	])('carries the security headers: %s', async (_label, url, routeId, status) => {
		const response = await hooks.handle({
			event: eventFor(url, { routeId }),
			resolve: resolving(status)
		});

		expectSecurityHeaders(response);
	});
});

describe('pageviews', () => {
	it('counts a page that rendered', async () => {
		const event = eventFor('https://numbrrs.app/game/nhl/TOR', { routeId: TEAM_ROUTE });

		await hooks.handle({ event, resolve: resolving() });

		expect(mocks.recordEvent).toHaveBeenCalledTimes(1);
		expect(mocks.recordEvent).toHaveBeenCalledWith(event, { name: 'pageview' });
	});

	it('does not count an error page', async () => {
		await hooks.handle({
			event: eventFor('https://numbrrs.app/game/nhl/XXX', { routeId: TEAM_ROUTE }),
			resolve: resolving(404)
		});

		expect(mocks.recordEvent).not.toHaveBeenCalled();
	});

	it('does not count anything that is not a page', async () => {
		await hooks.handle({
			event: eventFor('https://numbrrs.app/api/health', { routeId: '/api/health' }),
			resolve: resolving()
		});
		await hooks.handle({ event: eventFor('https://numbrrs.app/nope'), resolve: resolving(404) });

		expect(mocks.recordEvent).not.toHaveBeenCalled();
	});
});

describe('handleError', () => {
	type Caught = Parameters<HandleError>[0];

	const caught = (input: Omit<Caught, 'event'>, url = 'https://numbrrs.app/game/nhl/TOR') =>
		({ ...input, event: eventFor(url, { routeId: TEAM_ROUTE }) }) as Caught;

	it('records an error nobody raised on purpose, and returns its id for the error page', async () => {
		const error = new Error('boom');

		const result = await hooks.handleError(caught({ kind: 'unknown', error }));

		expect(mocks.reportError).toHaveBeenCalledWith({
			source: 'server',
			message: 'boom',
			stack: error.stack,
			route: TEAM_ROUTE,
			// Handed over whole, so the reason behind a "fetch failed" is kept.
			error
		});
		expect(result).toEqual({ id: 'fingerprint-1' });
	});

	it('records something thrown that is not an Error', async () => {
		await hooks.handleError(caught({ kind: 'unknown', error: 'just a string' }));

		expect(mocks.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'just a string', stack: null })
		);
	});

	it.each([
		['app', 500, 'Rosters unavailable'],
		['app', 503, 'Upstream is down'],
		['framework', 500, 'Internal Error']
	] as const)('records a deliberate server error: %s %i', async (kind, status, message) => {
		const result = await hooks.handleError(caught({ kind, error: { status, message } }));

		expect(mocks.reportError).toHaveBeenCalledWith({
			source: 'server',
			message: `${status} ${message}`,
			stack: null,
			route: TEAM_ROUTE,
			error: null
		});
		expect(result).toEqual({ id: 'fingerprint-1' });
	});

	it.each([
		['app', 404, 'Team not found'],
		['app', 429, 'Too many reports'],
		['framework', 404, 'Not Found'],
		['framework', 405, 'POST method not allowed'],
		['framework', 400, 'Malformed URI']
	] as const)('stays quiet about a routine one: %s %i', async (kind, status, message) => {
		const result = await hooks.handleError(caught({ kind, error: { status, message } }));

		expect(mocks.reportError).not.toHaveBeenCalled();
		// Nothing returned, so the visitor sees the status and message as raised.
		expect(result).toBeUndefined();
	});

	it('stays quiet about a rejected remote-function argument', async () => {
		const result = await hooks.handleError(
			caught({ kind: 'validation', error: { status: 400, message: 'Bad Request' }, issues: [] })
		);

		expect(mocks.reportError).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('names the path when the URL matched no route', async () => {
		const event = eventFor('https://numbrrs.app/somewhere/odd');

		await hooks.handleError({ kind: 'unknown', error: new Error('boom'), event });

		expect(mocks.reportError).toHaveBeenCalledWith(
			expect.objectContaining({ route: '/somewhere/odd' })
		);
	});
});

describe('boot', () => {
	async function boot(overrides: Partial<typeof world>): Promise<void> {
		Object.assign(world, overrides);
		vi.resetModules();
		await import('./hooks.server.ts');
	}

	// Every boot hangs a listener on the real process; left there, they pile up
	// across this file's re-imports.
	afterEach(() => {
		process.removeAllListeners('sveltekit:shutdown');
	});

	it('opens the database and starts the sweeps in production, in that order', async () => {
		await boot({});

		expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
		expect(mocks.startSweeps).toHaveBeenCalledTimes(1);
		expect(mocks.installProcessGuards).toHaveBeenCalledTimes(1);
		expect(mocks.bootstrap.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.startSweeps.mock.invocationCallOrder[0] ?? 0
		);
		expect(warn).not.toHaveBeenCalled();
		expect(mocks.reportError).not.toHaveBeenCalled();
	});

	it('does nothing at all during a build', async () => {
		await boot({ building: true, adminDirect: true, adminToken: 'short' });

		expect(mocks.bootstrap).not.toHaveBeenCalled();
		expect(mocks.startSweeps).not.toHaveBeenCalled();
		expect(mocks.installProcessGuards).not.toHaveBeenCalled();
		expect(process.listenerCount('sveltekit:shutdown')).toBe(0);
		expect(warn).not.toHaveBeenCalled();
		// The record is a database write, and a build has no database.
		expect(mocks.reportError).not.toHaveBeenCalled();
	});

	it('closes the database once the server has shut down', async () => {
		await boot({});
		expect(mocks.closeDb).not.toHaveBeenCalled();

		process.emit('sveltekit:shutdown', 'SIGTERM');

		expect(mocks.closeDb).toHaveBeenCalledTimes(1);
	});

	it('opens the database in dev but starts no sweeps and gives no warnings', async () => {
		await boot({ dev: true, adminDirect: true, adminToken: 'short' });

		expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
		expect(mocks.startSweeps).not.toHaveBeenCalled();
		// A handler that ends the process does not belong under a dev server.
		expect(mocks.installProcessGuards).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
		// The switch does nothing on localhost, so there is nothing to raise.
		expect(mocks.reportError).not.toHaveBeenCalled();
	});

	it('says so in the logs when the Access check is switched off', async () => {
		await boot({ adminDirect: true });

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('ADMIN_DIRECT is set'));
	});

	it('raises one alert when the emergency switch is on, once the database is open', async () => {
		await boot({ adminDirect: true });

		expect(mocks.reportError).toHaveBeenCalledTimes(1);
		expect(mocks.reportError).toHaveBeenCalledWith({
			source: 'server',
			message:
				'ADMIN_DIRECT is on: numbrrs.fly.dev is serving the site directly and /admin is skipping Cloudflare Access. Unset it once Cloudflare is back.',
			route: 'boot:admin-direct'
		});
		// The report is a row in the database before it is anything else.
		expect(mocks.bootstrap.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.reportError.mock.invocationCallOrder[0] ?? 0
		);
	});

	it('raises the same alert at every boot, so the cooldown can fold them into one', async () => {
		await boot({ adminDirect: true });
		await boot({ adminDirect: true });

		// Same source, message and route, which is all a fingerprint is made from.
		expect(mocks.reportError).toHaveBeenCalledTimes(2);
		expect(mocks.reportError.mock.calls[0]).toEqual(mocks.reportError.mock.calls[1]);
	});

	it('warns about a short admin token without printing it, and still boots', async () => {
		await boot({ adminToken: 'hunter2' });

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('ADMIN_TOKEN is 7 characters'));
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('hunter2'));
		expect(mocks.bootstrap).toHaveBeenCalledTimes(1);
		expect(mocks.startSweeps).toHaveBeenCalledTimes(1);
	});

	it('has nothing to say about a token of the documented length', async () => {
		await boot({ adminToken: 'f'.repeat(64) });

		expect(warn).not.toHaveBeenCalled();
	});
});
