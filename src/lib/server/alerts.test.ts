import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { errors } from './db/schema';
import { fingerprintOf } from './telemetry';

// Never a real webhook: this file exists to make reportError post, so the URL
// is a reserved name that cannot resolve and fetch is replaced in every test.
// Nothing here reads the ambient environment.
const WEBHOOK = 'https://example.invalid/webhook/secret-token';
const HOUR = 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 21, 12, 0, 0);

type Alerts = typeof import('./alerts');
type DbModule = typeof import('./db');

let alerts: Alerts;
let db: DbModule;
let fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>>;

/**
 * A fresh copy of the module for each test — its cooldowns and budgets are
 * module state, and one test's pings would otherwise spend the next one's.
 * The database module has to come from the same fresh graph, or `alerts` would
 * be writing to a different instance than the one the test reads.
 */
async function load(webhook: string): Promise<void> {
	vi.resetModules();
	vi.doMock('$app/env/private', () => ({
		ALERT_WEBHOOK_URL: webhook,
		ADMIN_TOKEN: undefined,
		ADMIN_DIRECT: false,
		EDGE_TOKEN: undefined,
		DATABASE_URL: ':memory:'
	}));
	db = await import('./db');
	db.initDb(new Database(':memory:'));
	alerts = await import('./alerts');
}

function advance(ms: number): void {
	vi.setSystemTime(Date.now() + ms);
}

/** Let the fire-and-forget POST and what follows it settle. */
async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

function posted(): string[] {
	return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)).content as string);
}

function rowFor(fingerprint: string) {
	return db.getDb().select().from(errors).where(eq(errors.fingerprint, fingerprint)).get();
}

beforeEach(async () => {
	// Only the clock: the POST is a real promise chain and has to keep running.
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(START);
	fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(console, 'error').mockImplementation(() => {});
	await load(WEBHOOK);
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('recording', () => {
	it('writes one row per fingerprint and counts repeats', () => {
		const first = alerts.reportError({ source: 'server', message: 'Team 42 missing', route: '/a' });
		const second = alerts.reportError({
			source: 'server',
			message: 'Team 97 missing',
			route: '/a'
		});

		expect(second).toBe(first);
		expect(first).toBe(fingerprintOf('server', 'Team 42 missing', '/a'));
		expect(rowFor(first)).toMatchObject({ count: 2, message: 'Team 97 missing', source: 'server' });
	});

	it('with a blank webhook writes the row and never fetches', async () => {
		await load('');

		const id = alerts.reportError({ source: 'server', message: 'boom', route: '/a' });
		await settle();

		expect(rowFor(id)).toMatchObject({ count: 1, notifiedAt: null });
		expect(fetchMock).not.toHaveBeenCalled();
		expect(alerts.webhookHealth()).toEqual({ configured: false, last: null });
	});

	it('caps the route and keeps it on one line', () => {
		const id = alerts.reportError({
			source: 'server',
			message: 'boom',
			route: `/x\r\n[server] forged${'y'.repeat(300)}`
		});

		const route = rowFor(id)?.route ?? '';
		expect(route).toHaveLength(200);
		expect(route).not.toMatch(/[\r\n]/);
	});

	it('appends the cause chain to the stored message without changing the fingerprint', () => {
		const error = new Error('fetch failed', {
			cause: new Error('connect ECONNREFUSED', { cause: 'socket closed' })
		});

		const id = alerts.reportError({ source: 'sync', message: 'Sync failed', route: 's', error });

		expect(id).toBe(fingerprintOf('sync', 'Sync failed', 's'));
		expect(rowFor(id)?.message).toBe(
			'Sync failed — caused by: connect ECONNREFUSED — caused by: socket closed'
		);
	});

	it('survives a cause chain that loops back on itself', () => {
		const a = new Error('a');
		const b = new Error('b', { cause: a });
		a.cause = b;

		expect(() =>
			alerts.reportError({ source: 'server', message: 'looped', error: a })
		).not.toThrow();
	});
});

describe('logging', () => {
	it('logs the whole stack and each cause, past what the row keeps', () => {
		const stack = `Error: boom\n${'    at frame (file.js:1:1)\n'.repeat(60)}    at last (end.js:9:9)`;
		const cause = new Error('root cause');

		const id = alerts.reportError({
			source: 'server',
			message: 'boom',
			stack,
			error: new Error('boom', { cause })
		});

		const logged = vi
			.mocked(console.error)
			.mock.calls.map((call) => String(call[0]))
			.join('\n');
		expect(logged).toContain('at last (end.js:9:9)');
		expect(logged).toContain('Caused by: Error: root cause');
		expect(rowFor(id)?.stack).not.toContain('at last (end.js:9:9)');
	});

	it('cannot be made to start a log line of its own', () => {
		alerts.reportError({
			source: 'client',
			message: 'oops\n[server] /admin (deadbeef): forged',
			stack: 'x\r\n[server] /admin (deadbeef): also forged',
			route: '/a\n[server] forged'
		});

		const logged = String(vi.mocked(console.error).mock.calls[0]?.[0]);
		const lines = logged.split('\n');
		expect(lines[0]).toMatch(/^\[client\] /);
		for (const line of lines.slice(1)) expect(line).toMatch(/^ {4}/);
	});
});

describe('the Discord message', () => {
	it('neutralises backticks and pings nobody', async () => {
		alerts.reportError({
			source: 'client',
			message: 'bad ``` @everyone',
			stack: 'stack with ``` fence\n@here',
			route: '/a`b'
		});
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe(WEBHOOK);
		const body = JSON.parse(String(init.body));
		expect(body.allowed_mentions).toEqual({ parse: [] });
		// The only backticks left are the ones the formatter put there itself: one
		// pair around the route, two fences around the body.
		expect(body.content.match(/`/g)).toHaveLength(8);
		expect(body.content).toContain('client (unauthenticated)');
	});

	it('leads with the message when the stack does not already say it', async () => {
		alerts.reportError({
			source: 'sync',
			message: 'Sync failed',
			stack: 'TypeError: fetch failed\n    at x',
			error: new Error('fetch failed', { cause: new Error('ETIMEDOUT') })
		});
		await settle();

		expect(posted()[0]).toContain('Sync failed — caused by: ETIMEDOUT\nTypeError: fetch failed');
	});
});

describe('cooldown per fingerprint', () => {
	const report = { source: 'server', message: 'flapping', route: '/a' } as const;

	it('pings once, then stays quiet until the hour is up', async () => {
		const id = alerts.reportError(report);
		advance(59 * 60 * 1000);
		alerts.reportError(report);
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(rowFor(id)).toMatchObject({ count: 2, notifiedAt: START });

		advance(60 * 1000);
		alerts.reportError(report);
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(posted()[1]).toContain('3× so far');
	});

	it('escalates a fault that keeps firing: 1h, then 6h, then daily', async () => {
		const pingedAt: number[] = [];
		// Every ten minutes for three days.
		for (let elapsed = 0; elapsed <= 72 * HOUR; elapsed += HOUR / 6) {
			vi.setSystemTime(START + elapsed);
			const before = fetchMock.mock.calls.length;
			alerts.reportError(report);
			if (fetchMock.mock.calls.length > before) pingedAt.push(elapsed / HOUR);
		}
		await settle();

		expect(pingedAt).toEqual([0, 1, 7, 31, 55]);
	});

	it('starts over once the fault has been quiet for a day', async () => {
		alerts.reportError(report);
		advance(HOUR);
		alerts.reportError(report);
		// Second ping: the cooldown is now six hours.
		advance(2 * HOUR);
		alerts.reportError(report);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);

		advance(25 * HOUR);
		alerts.reportError(report);
		advance(HOUR);
		alerts.reportError(report);
		await settle();

		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('honours the stored notified_at after a restart', async () => {
		const id = alerts.reportError(report);
		await settle();

		// A new process: same database file, empty memory.
		const client = new Database(':memory:');
		const previous = rowFor(id)!;
		vi.resetModules();
		db = await import('./db');
		db.initDb(client);
		db.getDb().insert(errors).values(previous).run();
		alerts = await import('./alerts');

		advance(30 * 60 * 1000);
		alerts.reportError(report);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		advance(30 * 60 * 1000);
		alerts.reportError(report);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});

describe('budget per source', () => {
	function burst(source: 'server' | 'sync' | 'client', count: number): void {
		for (let i = 0; i < count; i++) {
			alerts.reportError({ source, message: `${source} fault`, route: `/${source}/${i}` });
		}
	}

	it('allows 3 server, 2 sync and 1 client ping an hour', async () => {
		burst('server', 6);
		burst('sync', 6);
		burst('client', 6);
		await settle();

		const sent = posted().filter((content) => !content.includes('suppressed'));
		expect(sent.filter((c) => c.includes('numbrrs server error'))).toHaveLength(3);
		expect(sent.filter((c) => c.includes('numbrrs sync error'))).toHaveLength(2);
		expect(sent.filter((c) => c.includes('numbrrs client'))).toHaveLength(1);
	});

	it('does not let client or sync noise spend the server budget', async () => {
		burst('client', 50);
		burst('sync', 50);
		burst('server', 1);
		await settle();

		expect(posted().some((content) => content.includes('numbrrs server error'))).toBe(true);
	});

	it('frees up again an hour later', async () => {
		burst('client', 2);
		advance(HOUR);
		alerts.reportError({ source: 'client', message: 'client fault', route: '/client/1' });
		await settle();

		expect(posted().filter((c) => c.includes('numbrrs client'))).toHaveLength(2);
	});

	it('leaves a suppressed fingerprint unmarked, so it is next in line', async () => {
		burst('client', 2);
		await settle();

		const held = fingerprintOf('client', 'client fault', '/client/1');
		expect(rowFor(held)).toMatchObject({ count: 1, notifiedAt: null });
	});

	it('says how many were suppressed, at most once an hour', async () => {
		burst('sync', 8);
		burst('client', 3);
		await settle();

		// Sent with the first alert held back, so it counts only that one.
		const first = posted().filter((content) => content.includes('suppressed'));
		expect(first).toHaveLength(1);
		expect(first[0]).toContain('1 alert suppressed** (sync 1)');

		advance(30 * 60 * 1000);
		burst('sync', 8);
		await settle();
		expect(posted().filter((content) => content.includes('suppressed'))).toHaveLength(1);

		// The next notice carries everything held back since the first, each
		// fingerprint once however many times it recurred: six of the eight sync
		// faults (two were posted) and two of the three client ones.
		advance(31 * 60 * 1000);
		burst('client', 3);
		await settle();
		const notices = posted().filter((content) => content.includes('suppressed'));
		expect(notices).toHaveLength(2);
		expect(notices[1]).toContain('8 alerts suppressed** (sync 6, client 2)');
	});
});

describe('when the webhook fails', () => {
	const report = { source: 'server', message: 'undelivered', route: '/a' } as const;

	it('hands the ping back so the next occurrence retries', async () => {
		fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }));

		const id = alerts.reportError(report);
		await settle();
		expect(rowFor(id)?.notifiedAt).toBeNull();
		expect(alerts.webhookHealth()).toEqual({
			configured: true,
			last: { at: START, ok: false, detail: 'HTTP 429' }
		});

		advance(1000);
		alerts.reportError(report);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(rowFor(id)?.notifiedAt).toBe(START + 1000);
		expect(alerts.webhookHealth().last).toEqual({ at: START + 1000, ok: true, detail: 'HTTP 204' });
	});

	it('keeps retries inside the budget while it stays down', async () => {
		fetchMock.mockRejectedValue(new Error('fetch failed'));

		for (let i = 0; i < 20; i++) {
			alerts.reportError(report);
			await settle();
		}

		// Three attempts for the error, one for the suppression notice.
		expect(fetchMock).toHaveBeenCalledTimes(4);
	});

	it('never puts the webhook URL in the health detail or the log', async () => {
		fetchMock.mockRejectedValueOnce(new TypeError(`Failed to parse URL from ${WEBHOOK}`));

		alerts.reportError(report);
		await settle();

		expect(alerts.webhookHealth().last?.detail).toBe('Failed to parse URL from <webhook>');
		const logged = vi.mocked(console.error).mock.calls.flat().map(String).join('\n');
		expect(logged).not.toContain('secret-token');
	});
});

describe('when the database write fails', () => {
	const report = { source: 'server', message: 'disk full', route: '/a' } as const;

	beforeEach(() => {
		vi.spyOn(db, 'getDb').mockImplementation(() => {
			throw new Error('SQLITE_FULL: database or disk is full');
		});
	});

	it('still returns the fingerprint and still pings, saying it was not recorded', async () => {
		const id = alerts.reportError(report);
		await settle();

		expect(id).toBe(fingerprintOf('server', 'disk full', '/a'));
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(posted()[0]).toContain('**Not recorded**');
		expect(posted()[0]).toContain('SQLITE_FULL');
	});

	it('holds the same fingerprint to its cooldown from memory alone', async () => {
		alerts.reportError(report);
		advance(10 * 60 * 1000);
		alerts.reportError(report);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(1);

		advance(50 * 60 * 1000);
		alerts.reportError(report);
		await settle();
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('does not loop when the webhook is failing too', async () => {
		fetchMock.mockRejectedValue(new Error('fetch failed'));

		for (let i = 0; i < 20; i++) {
			expect(() => alerts.reportError(report)).not.toThrow();
			await settle();
		}

		expect(fetchMock).toHaveBeenCalledTimes(4);
	});
});
