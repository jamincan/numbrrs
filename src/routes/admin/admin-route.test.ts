import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { isActionFailure, isRedirect, type Cookies } from '@sveltejs/kit';
import { ADMIN_COOKIE, loginDelay } from '#lib/server/admin.ts';
import { getDb, initDb } from '#lib/server/db/index.ts';
import { errors, events, players, syncState, teams } from '#lib/server/db/schema.ts';
import { dayKey } from '#lib/server/telemetry.ts';

/**
 * The admin page's server module, driven the way SvelteKit drives it: `load`
 * for the page and each action as its own endpoint. The session and token
 * checks are the real ones from #lib/server/admin, so what is pinned here is
 * that every way into the dashboard's data or its resync goes through them.
 */
const TOKEN = 'test-admin-token-0123456789abcdef0123456789abcdef';

const env = vi.hoisted(() => ({
	adminToken: undefined as string | undefined,
	adminDirect: false,
	webhook: undefined as string | undefined
}));

const sync = vi.hoisted(() => ({
	syncRostersOnce: vi.fn(),
	status: { running: false, startedAt: null as number | null }
}));

vi.mock('$app/env/private', () => ({
	get ADMIN_TOKEN() {
		return env.adminToken;
	},
	get ADMIN_DIRECT() {
		return env.adminDirect;
	},
	get ALERT_WEBHOOK_URL() {
		return env.webhook;
	},
	EDGE_TOKEN: undefined,
	DATABASE_URL: ':memory:'
}));

// The page imports the sync layer, which reports failures; nothing here should
// be able to reach the real reporter, or a league.
vi.mock('#lib/server/alerts.ts', () => ({ reportError: vi.fn() }));
vi.mock('#lib/server/leagues/index.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/leagues/index.ts')>()),
	syncRostersOnce: sync.syncRostersOnce,
	fullSyncStatus: () => sync.status
}));
// Only the pause after a failed login is replaced, so the tests don't sit
// through it. Every check that decides who gets in is the real one.
vi.mock('#lib/server/admin.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/admin.ts')>()),
	loginDelay: vi.fn(() => Promise.resolve())
}));

interface PageData {
	state: 'unconfigured' | 'locked' | 'open';
	directAccess: boolean;
	stats?: {
		today: { views: number; visitors: number };
		last30: { views: number };
		served: {
			periods: {
				label: string;
				edgeViews: number;
				originViews: number;
				edgeOnly: number;
				both: number;
				originOnly: number;
			}[];
			recorded: boolean;
			since: string | null;
		};
		topTeams: { name: string; views: number }[];
		recentErrors: { fingerprint: string }[];
		alertsConfigured: boolean;
	};
	sync?: {
		running: boolean;
		totalTeams: number;
		totalDone: number;
		leagues: {
			id: string;
			teams: number;
			stale: number;
			done: number;
			oldestRoster: number | null;
			teamListSyncedAt: number | null;
		}[];
	};
}

type Action = (event: unknown) => Promise<unknown>;

const route = await import('./+page.server');
const load = route.load as unknown as (event: unknown) => Promise<PageData>;
const actions = route.actions as unknown as Record<'login' | 'logout' | 'resync', Action>;

interface CookieOptions {
	path?: string;
	httpOnly?: boolean;
	sameSite?: string;
	secure?: boolean;
	maxAge?: number;
}

/** A cookie jar that remembers how each cookie was set, not just its value. */
function cookieJar(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const options = new Map<string, CookieOptions>();
	const cookies = {
		get: (name: string) => values.get(name),
		set: (name: string, value: string, opts: CookieOptions) => {
			values.set(name, value);
			options.set(name, opts);
		},
		delete: (name: string) => {
			values.delete(name);
			options.delete(name);
		}
	} as unknown as Cookies;
	return { cookies, values, options };
}

// The login limiter is per address and lives as long as the module does, so
// each request comes from its own address unless a test says otherwise.
let lastAddress = 0;
const freshAddress = () => `203.0.113.${++lastAddress}`;

function post(
	fields: Record<string, string>,
	{ jar = cookieJar(), address = freshAddress() } = {}
) {
	const url = new URL('https://numbrrs.test/admin');
	return {
		jar,
		event: {
			cookies: jar.cookies,
			url,
			request: new Request(url, { method: 'POST', body: new URLSearchParams(fields) }),
			getClientAddress: () => address
		}
	};
}

/** Sign in for real, and hand back the jar holding the session it was given. */
async function signedIn() {
	const { jar, event } = post({ token: TOKEN });
	await actions.login(event).catch((thrown: unknown) => {
		if (!isRedirect(thrown)) throw thrown;
	});
	expect(jar.values.has(ADMIN_COOKIE)).toBe(true);
	return jar;
}

function failure(result: unknown): { status: number } {
	if (!isActionFailure(result))
		throw new Error(`Expected a failure, got ${JSON.stringify(result)}`);
	return result;
}

function seedTeam(id: string, rosterSyncedAt: number | null, withPlayer = true): void {
	const [league = '', code = ''] = id.split(':');
	getDb()
		.insert(teams)
		.values({ id, league, name: `${code} Team`, abbreviation: code, logoUrl: '', rosterSyncedAt })
		.run();
	if (!withPlayer) return;
	getDb()
		.insert(players)
		.values({
			league,
			id: getDb().select().from(players).all().length + 1,
			teamId: id,
			firstName: 'First',
			lastName: 'Last',
			positionCode: 'C',
			headshotUrl: ''
		})
		.run();
}

function seedPageview(at: number, team: string | null = null): void {
	getDb()
		.insert(events)
		.values({
			at,
			day: dayKey(at),
			name: 'pageview',
			path: '/',
			league: team ? 'nhl' : null,
			team,
			locale: 'en',
			visitorHash: `visitor-${at}`
		})
		.run();
}

/** A view that says who served it, from a visitor named so two views can be one person's. */
function seedServed(at: number, servedBy: 'edge' | 'origin' | null, visitor: string): void {
	getDb()
		.insert(events)
		.values({
			at,
			day: dayKey(at),
			name: 'pageview',
			path: '/',
			locale: 'en',
			visitorHash: visitor,
			servedBy
		})
		.run();
}

beforeEach(() => {
	initDb(new Database(':memory:'));
	Object.assign(env, { adminToken: TOKEN, adminDirect: false, webhook: undefined });
	sync.status = { running: false, startedAt: null };
	sync.syncRostersOnce.mockReset().mockReturnValue({ started: true, done: Promise.resolve() });
	vi.mocked(loginDelay).mockClear();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('load', () => {
	it('reports itself unconfigured when no token is set, and shows nothing', async () => {
		env.adminToken = undefined;
		seedPageview(Date.now());

		const data = await load({ cookies: cookieJar().cookies });

		expect(data).toEqual({ state: 'unconfigured', directAccess: false });
	});

	it('is locked without a session, and carries no stats or sync data', async () => {
		seedPageview(Date.now());
		seedTeam('nhl:TOR', Date.now());

		const data = await load({ cookies: cookieJar().cookies });

		expect(data).toEqual({ state: 'locked', directAccess: false });
		expect(data).not.toHaveProperty('stats');
		expect(data).not.toHaveProperty('sync');
	});

	it.each([
		['a made-up cookie', 'not-a-session'],
		['an unsigned expiry', `${Date.now() + 60_000}.`],
		['a signature from another token', `${Date.now() + 60_000}.${'0'.repeat(64)}`]
	])('stays locked for %s', async (_name, cookie) => {
		const data = await load({ cookies: cookieJar({ [ADMIN_COOKIE]: cookie }).cookies });

		expect(data.state).toBe('locked');
		expect(data).not.toHaveProperty('stats');
	});

	it('stays locked for a session signed under a token that has since been rotated', async () => {
		const jar = await signedIn();
		env.adminToken = `${TOKEN}-rotated`;

		expect((await load({ cookies: jar.cookies })).state).toBe('locked');
	});

	it('opens for a session, with stats and the sync panel', async () => {
		const now = Date.now();
		seedPageview(now, 'TOR');
		seedPageview(now - 1000, 'TOR');
		seedTeam('nhl:TOR', now);

		const data = await load({ cookies: (await signedIn()).cookies });

		expect(data.state).toBe('open');
		expect(data.stats?.today.views).toBe(2);
		expect(data.stats?.topTeams).toEqual([
			{ league: 'nhl', team: 'TOR', views: 2, name: 'TOR Team' }
		]);
		expect(data.sync?.totalTeams).toBe(1);
		expect(data.sync?.running).toBe(false);
	});

	it('says on every state when direct access is switched on', async () => {
		env.adminDirect = true;

		expect((await load({ cookies: cookieJar().cookies })).directAccess).toBe(true);
		expect((await load({ cookies: (await signedIn()).cookies })).directAccess).toBe(true);
		env.adminToken = undefined;
		expect((await load({ cookies: cookieJar().cookies })).directAccess).toBe(true);
	});

	it('reports whether alerts are configured without exposing the webhook', async () => {
		env.webhook = 'https://discord.test/api/webhooks/1/secret';

		const data = await load({ cookies: (await signedIn()).cookies });

		expect(data.stats?.alertsConfigured).toBe(true);
		expect(JSON.stringify(data)).not.toContain('discord.test');
	});
});

describe('the sync panel', () => {
	it('counts stale teams the way the sync layer does', async () => {
		const now = Date.now();
		const HOUR = 60 * 60 * 1000;
		seedTeam('nhl:TOR', now - HOUR);
		seedTeam('nhl:BOS', now - 13 * HOUR);
		seedTeam('nhl:MTL', null);
		// Synced recently but holding nobody: the sweep will refresh it, so it is
		// stale here too.
		seedTeam('nhl:OTT', now - HOUR, false);

		const data = await load({ cookies: (await signedIn()).cookies });

		const nhl = data.sync?.leagues.find((l) => l.id === 'nhl');
		expect(nhl).toMatchObject({ teams: 4, stale: 3, oldestRoster: null });
	});

	it('shows a team list that has only ever failed as never synced', async () => {
		const now = Date.now();
		getDb()
			.insert(syncState)
			.values([
				{ key: 'teams:nhl', syncedAt: 0, failedAt: now, failureCount: 2 },
				{ key: 'teams:pwhl', syncedAt: now - 5000, failedAt: null, failureCount: 0 }
			])
			.run();

		const data = await load({ cookies: (await signedIn()).cookies });

		const byId = new Map(data.sync?.leagues.map((l) => [l.id, l.teamListSyncedAt]));
		expect(byId.get('nhl')).toBeNull();
		expect(byId.get('pwhl')).toBe(now - 5000);
		expect(byId.get('ohl')).toBeNull();
	});

	it('measures a running sync against when it started', async () => {
		const startedAt = Date.now() - 60_000;
		sync.status = { running: true, startedAt };
		seedTeam('nhl:TOR', startedAt + 1000);
		seedTeam('nhl:BOS', startedAt - 1000);
		seedTeam('pwhl:TOR', null);

		const data = await load({ cookies: (await signedIn()).cookies });

		expect(data.sync).toMatchObject({ running: true, totalTeams: 3, totalDone: 1 });
	});
});

describe('usage figures', () => {
	it('are reused for a minute while the sync panel and errors stay current', async () => {
		vi.useFakeTimers({ toFake: ['Date'] });
		const start = Date.now();
		const jar = await signedIn();
		seedPageview(start);

		const first = await load({ cookies: jar.cookies });
		expect(first.stats?.today.views).toBe(1);
		expect(first.sync?.totalTeams).toBe(0);
		expect(first.stats?.recentErrors).toEqual([]);

		seedPageview(start + 1);
		seedTeam('nhl:TOR', start);
		getDb()
			.insert(errors)
			.values({
				fingerprint: 'abc',
				source: 'server',
				message: 'boom',
				firstSeen: start,
				lastSeen: start,
				count: 1
			})
			.run();

		vi.setSystemTime(start + 59_000);
		const polled = await load({ cookies: jar.cookies });
		expect(polled.stats?.today.views).toBe(1);
		expect(polled.sync?.totalTeams).toBe(1);
		expect(polled.stats?.recentErrors.map((e) => e.fingerprint)).toEqual(['abc']);

		vi.setSystemTime(start + 60_000);
		const later = await load({ cookies: jar.cookies });
		expect(later.stats?.today.views).toBe(2);
	});

	it('are never served to a request without a session, cached or not', async () => {
		seedPageview(Date.now());
		const open = await load({ cookies: (await signedIn()).cookies });
		expect(open.stats?.today.views).toBe(1);

		const locked = await load({ cookies: cookieJar().cookies });

		expect(locked).toEqual({ state: 'locked', directAccess: false });
	});
});

describe('the edge cache and server split', () => {
	const DAY = 24 * 60 * 60 * 1000;

	// Midday, so a day either side of it is the calendar day either side.
	async function openAt(seed: (now: number) => void) {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date(2026, 10, 18, 12));
		const jar = await signedIn();
		seed(Date.now());
		const data = await load({ cookies: jar.cookies });
		if (!data.stats) throw new Error('Expected the dashboard to open');
		return data.stats.served;
	}

	it('counts views by who served them, and visitors by who they were served by', async () => {
		const served = await openAt((now) => {
			// Today: one visitor served by both, one by the cache alone, twice, and
			// one by the server alone.
			seedServed(now, 'edge', 'ann');
			seedServed(now, 'origin', 'ann');
			seedServed(now, 'edge', 'bo');
			seedServed(now, 'edge', 'bo');
			seedServed(now, 'origin', 'cy');
			// Yesterday: the first of them again, who is somebody new as far as a
			// daily hash can tell, and this time saw only the server.
			seedServed(now - DAY, 'origin', 'ann');
		});

		expect(served.periods).toEqual([
			{ label: 'Today', edgeViews: 3, originViews: 2, edgeOnly: 1, both: 1, originOnly: 1 },
			{ label: '7 days', edgeViews: 3, originViews: 3, edgeOnly: 1, both: 1, originOnly: 2 },
			{ label: '30 days', edgeViews: 3, originViews: 3, edgeOnly: 1, both: 1, originOnly: 2 }
		]);
		expect(served.recorded).toBe(true);
		// Every view in the window says who served it, so there is no start to name.
		expect(served.since).toBeNull();
	});

	it('leaves out views from before it was recorded, and says when the count starts', async () => {
		const served = await openAt((now) => {
			seedServed(now - 10 * DAY, null, 'old');
			seedServed(now - 3 * DAY, null, 'dee');
			seedServed(now - 3 * DAY, 'origin', 'dee');
			seedServed(now, 'edge', 'eve');
		});

		expect(served.periods.at(-1)).toEqual({
			label: '30 days',
			edgeViews: 1,
			originViews: 1,
			edgeOnly: 1,
			both: 0,
			originOnly: 1
		});
		expect(served.recorded).toBe(true);
		expect(served.since).toBe(dayKey(Date.now() - 3 * DAY));
	});

	it('says so when no view yet says who served it', async () => {
		const served = await openAt((now) => seedServed(now, null, 'old'));

		expect(served.recorded).toBe(false);
		expect(served.since).toBeNull();
		expect(served.periods.map((period) => period.edgeViews + period.originViews)).toEqual([
			0, 0, 0
		]);
	});

	it('is all zeroes on a table with nothing in it', async () => {
		const served = await openAt(() => {});

		expect(served.recorded).toBe(false);
		expect(served.periods).toHaveLength(3);
		expect(served.periods[0]).toEqual({
			label: 'Today',
			edgeViews: 0,
			originViews: 0,
			edgeOnly: 0,
			both: 0,
			originOnly: 0
		});
	});
});

describe('resync', () => {
	it('refuses a request without a session, and starts nothing', async () => {
		const result = await actions.resync({ cookies: cookieJar().cookies });

		expect(failure(result).status).toBe(401);
		expect(sync.syncRostersOnce).not.toHaveBeenCalled();
	});

	it('refuses a forged session, and starts nothing', async () => {
		const forged = cookieJar({ [ADMIN_COOKIE]: `${Date.now() + 60_000}.${'f'.repeat(64)}` });

		const result = await actions.resync({ cookies: forged.cookies });

		expect(failure(result).status).toBe(401);
		expect(sync.syncRostersOnce).not.toHaveBeenCalled();
	});

	it('refuses everyone when no token is configured', async () => {
		const jar = await signedIn();
		env.adminToken = undefined;

		const result = await actions.resync({ cookies: jar.cookies });

		expect(failure(result).status).toBe(401);
		expect(sync.syncRostersOnce).not.toHaveBeenCalled();
	});

	it('starts a sync for a signed-in admin, without waiting for it', async () => {
		const jar = await signedIn();
		sync.syncRostersOnce.mockReturnValue({ started: true, done: new Promise(() => {}) });

		const result = await actions.resync({ cookies: jar.cookies });

		expect(result).toEqual({ message: 'Sync started.' });
		expect(sync.syncRostersOnce).toHaveBeenCalledTimes(1);
	});

	it('says so when a sync was already running', async () => {
		const jar = await signedIn();
		sync.syncRostersOnce.mockReturnValue({ started: false, done: Promise.resolve() });

		expect(await actions.resync({ cookies: jar.cookies })).toEqual({
			message: 'A sync was already running.'
		});
	});
});

describe('login', () => {
	it('sets an httpOnly, strict, /admin-scoped session cookie and redirects', async () => {
		const { jar, event } = post({ token: TOKEN });

		const thrown = await actions.login(event).then(
			() => null,
			(err: unknown) => err
		);

		expect(isRedirect(thrown)).toBe(true);
		expect(thrown).toMatchObject({ status: 303, location: '/admin' });
		expect(jar.options.get(ADMIN_COOKIE)).toMatchObject({
			path: '/admin',
			httpOnly: true,
			sameSite: 'strict',
			secure: true
		});
		expect(jar.options.get(ADMIN_COOKIE)?.maxAge).toBeGreaterThan(0);
		// The cookie is a signed expiry. It must never carry the token.
		expect(jar.values.get(ADMIN_COOKIE)).not.toContain(TOKEN);
		expect((await load({ cookies: jar.cookies })).state).toBe('open');
	});

	it.each([
		['a wrong token', { token: `${TOKEN}x` }],
		['a prefix of the token', { token: TOKEN.slice(0, 20) }],
		['an empty token', { token: '' }],
		['no token field at all', {}]
	])('answers %s with 401 and sets no cookie', async (_name, fields) => {
		const { jar, event } = post(fields as Record<string, string>);

		const result = await actions.login(event);

		expect(failure(result).status).toBe(401);
		expect(jar.values.size).toBe(0);
		expect(loginDelay).toHaveBeenCalledTimes(1);
		expect((await load({ cookies: jar.cookies })).state).toBe('locked');
	});

	it('answers the eleventh attempt from one address with 429, even with the right token', async () => {
		const address = freshAddress();
		for (let attempt = 1; attempt <= 10; attempt++) {
			const result = await actions.login(post({ token: 'wrong' }, { address }).event);
			expect(failure(result).status).toBe(401);
		}

		const { jar, event } = post({ token: TOKEN }, { address });
		const result = await actions.login(event);

		expect(failure(result).status).toBe(429);
		expect(jar.values.size).toBe(0);
		// Someone else is not locked out by it.
		await expect(actions.login(post({ token: TOKEN }).event)).rejects.toSatisfy(isRedirect);
	});

	it('answers 503 when no token is configured, whatever is submitted', async () => {
		env.adminToken = undefined;
		const { jar, event } = post({ token: '' });

		const result = await actions.login(event);

		expect(failure(result).status).toBe(503);
		expect(jar.values.size).toBe(0);
	});
});

describe('logout', () => {
	it('drops the session and redirects', async () => {
		const jar = await signedIn();

		await expect(actions.logout({ cookies: jar.cookies })).rejects.toSatisfy(isRedirect);

		expect(jar.values.has(ADMIN_COOKIE)).toBe(false);
		expect((await load({ cookies: jar.cookies })).state).toBe('locked');
	});
});
