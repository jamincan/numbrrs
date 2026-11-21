import type { RequestEvent } from '@sveltejs/kit';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NEGOTIATED_VARY, PAGE_CACHE, SECURITY_HEADERS } from '#lib/server/request-policy.ts';

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
		getClientAddress: () => '127.0.0.1'
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

	it('leaves the canonical host and the Fly hostname alone', async () => {
		for (const origin of ['https://numbrrs.app', 'https://numbrrs.fly.dev']) {
			const resolve = resolving();
			const response = await hooks.handle({
				event: eventFor(`${origin}/api/health`, { routeId: '/api/health' }),
				resolve
			});
			expect(response.status).toBe(200);
			expect(resolve).toHaveBeenCalledTimes(1);
		}
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

	it('keeps the home page private', async () => {
		const response = await hooks.handle({
			event: eventFor('https://numbrrs.app/', { routeId: HOME_ROUTE }),
			resolve: resolving()
		});

		expect(response.headers.get('cache-control')).toBe('private, no-cache');
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
	});

	it('does nothing at all during a build', async () => {
		await boot({ building: true, adminDirect: true, adminToken: 'short' });

		expect(mocks.bootstrap).not.toHaveBeenCalled();
		expect(mocks.startSweeps).not.toHaveBeenCalled();
		expect(mocks.installProcessGuards).not.toHaveBeenCalled();
		expect(process.listenerCount('sveltekit:shutdown')).toBe(0);
		expect(warn).not.toHaveBeenCalled();
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
	});

	it('says so in the logs when the Access check is switched off', async () => {
		await boot({ adminDirect: true });

		expect(warn).toHaveBeenCalledTimes(1);
		expect(warn).toHaveBeenCalledWith(expect.stringContaining('ADMIN_DIRECT is set'));
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
