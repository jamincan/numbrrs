import { beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { closeDb, initDb, getDb } from './db';
import { errors, events } from './db/schema';
import {
	deleteOldestEvents,
	pruneErrors,
	pruneEvents,
	pruneIfDue,
	recordEdgeViews,
	type EventPage,
	type EventVisitor
} from './analytics';

const NOW = 1_800_000_000_000;

function insertEvent(at: number): number {
	const rows = getDb()
		.insert(events)
		.values({
			at,
			day: 'ignored', // dayKey formatting isn't what's under test here
			name: 'pageview',
			path: '/',
			locale: 'en',
			visitorHash: 'abc123'
		})
		.returning({ id: events.id })
		.all();
	// A single-row insert's RETURNING always yields exactly one row.
	return rows[0]!.id;
}

function remainingIds(): number[] {
	return getDb()
		.select({ id: events.id })
		.from(events)
		.all()
		.map((r) => r.id)
		.sort((a, b) => a - b);
}

beforeEach(() => {
	initDb(new Database(':memory:'));
});

function insertError(
	fingerprint: string,
	source: 'server' | 'client' | 'sync',
	lastSeen: number
): void {
	getDb()
		.insert(errors)
		.values({ fingerprint, source, message: 'boom', firstSeen: lastSeen, lastSeen, count: 1 })
		.run();
}

function remainingErrors(): string[] {
	return getDb()
		.select({ fingerprint: errors.fingerprint })
		.from(errors)
		.all()
		.map((r) => r.fingerprint)
		.sort();
}

describe('deleteOldestEvents', () => {
	it('deletes the oldest matching rows first, by id', () => {
		for (let i = 0; i < 5; i++) insertEvent(NOW);

		const went = deleteOldestEvents({ before: NOW + 1 }, 3);

		expect(went).toBe(3);
		expect(remainingIds()).toEqual([4, 5]);
	});

	it('takes events before a time oldest-first, and leaves the rest', () => {
		insertEvent(NOW - 10);
		insertEvent(NOW - 30);
		insertEvent(NOW - 20);
		insertEvent(NOW);

		expect(deleteOldestEvents({ before: NOW }, 2)).toBe(2);
		expect(remainingIds()).toEqual([1, 4]);

		expect(deleteOldestEvents({ before: NOW }, 10)).toBe(1);
		expect(remainingIds()).toEqual([4]);
		expect(deleteOldestEvents({ before: NOW }, 10)).toBe(0);
	});

	it('takes events up to an id, lowest first', () => {
		for (let i = 0; i < 5; i++) insertEvent(NOW);

		expect(deleteOldestEvents({ throughId: 3 }, 2)).toBe(2);
		expect(remainingIds()).toEqual([3, 4, 5]);

		expect(deleteOldestEvents({ throughId: 3 }, 10)).toBe(1);
		expect(remainingIds()).toEqual([4, 5]);
	});
});

describe('pruneEvents', () => {
	it('removes events past the retention window before anything else', () => {
		insertEvent(NOW - 2000);
		insertEvent(NOW - 2000);
		insertEvent(NOW - 2000);
		insertEvent(NOW); // fresh
		insertEvent(NOW); // fresh

		const removed = pruneEvents(NOW, {
			retentionMs: 1000,
			maxEvents: 1000,
			pruneBatch: 10,
			pruneMaxRows: 10
		});

		expect(removed).toBe(3);
		expect(remainingIds()).toEqual([4, 5]);
	});

	it('trims oldest-first once the row-count ceiling is exceeded', () => {
		for (let i = 0; i < 8; i++) insertEvent(NOW);

		const removed = pruneEvents(NOW, {
			// A retention window bigger than NOW itself pushes the cutoff below
			// zero, so nothing is old enough for the age phase — isolates the
			// row-count phase this test is about.
			retentionMs: NOW + 1_000_000_000_000,
			maxEvents: 5,
			pruneBatch: 10,
			pruneMaxRows: 20
		});

		expect(removed).toBe(3);
		expect(remainingIds()).toEqual([4, 5, 6, 7, 8]);
	});

	it('stays bounded per call and converges over repeated calls', () => {
		for (let i = 0; i < 10; i++) insertEvent(NOW - 2000);

		const limits = { retentionMs: 1000, maxEvents: 1000, pruneBatch: 2, pruneMaxRows: 4 };

		expect(pruneEvents(NOW, limits)).toBe(4);
		expect(remainingIds()).toHaveLength(6);

		expect(pruneEvents(NOW, limits)).toBe(4);
		expect(remainingIds()).toHaveLength(2);

		expect(pruneEvents(NOW, limits)).toBe(2);
		expect(remainingIds()).toHaveLength(0);
	});

	it('keeps the newest rows under the ceiling when the oldest ids are already gone', () => {
		for (let i = 0; i < 4; i++) insertEvent(NOW - 2000);
		for (let i = 0; i < 6; i++) insertEvent(NOW);

		const removed = pruneEvents(NOW, {
			retentionMs: 1000,
			maxEvents: 4,
			pruneBatch: 10,
			pruneMaxRows: 20
		});

		// Four by age, then two more to get from six down to the ceiling of four.
		expect(removed).toBe(6);
		expect(remainingIds()).toEqual([7, 8, 9, 10]);
	});

	it('does nothing to a table at or under the ceiling', () => {
		for (let i = 0; i < 5; i++) insertEvent(NOW);

		expect(pruneEvents(NOW, { maxEvents: 5 })).toBe(0);
		expect(pruneEvents(NOW, { maxEvents: 50 })).toBe(0);
		expect(remainingIds()).toHaveLength(5);
	});

	it('does nothing to an empty table', () => {
		expect(pruneEvents(NOW, { maxEvents: 5 })).toBe(0);
	});

	it('finds every batch through an index, never by walking the table', () => {
		// This runs inside a visitor's request, against a table that can hold half
		// a million rows. The statements are captured as SQLite ran them and each
		// one's plan checked: a seek into an index or the primary key, not a scan.
		const statements: string[] = [];
		const client = new Database(':memory:', { verbose: (sql) => statements.push(String(sql)) });
		initDb(client);
		for (let i = 0; i < 4; i++) insertEvent(NOW - 2000);
		for (let i = 0; i < 6; i++) insertEvent(NOW);
		statements.length = 0;

		const removed = pruneEvents(NOW, {
			retentionMs: 1000,
			maxEvents: 4,
			pruneBatch: 2,
			pruneMaxRows: 20
		});

		expect(removed).toBe(6);
		const ran = [...statements];
		expect(ran.filter((sql) => /^select/i.test(sql)).length).toBeGreaterThanOrEqual(5);
		for (const sql of ran) {
			const plan = client.prepare(`explain query plan ${sql}`).all() as { detail: string }[];
			for (const step of plan) expect(`${step.detail} <- ${sql}`).toMatch(/^SEARCH /);
		}
		const plans = ran.map((sql) =>
			(client.prepare(`explain query plan ${sql}`).all() as { detail: string }[])
				.map((step) => step.detail)
				.join(' / ')
		);
		expect(plans.some((plan) => plan.includes('events_at_idx'))).toBe(true);
	});

	it('counts both phases against the one per-call ceiling', () => {
		for (let i = 0; i < 3; i++) insertEvent(NOW - 2000);
		for (let i = 0; i < 7; i++) insertEvent(NOW);

		const limits = { retentionMs: 1000, maxEvents: 2, pruneBatch: 2, pruneMaxRows: 4 };

		// Three by age, then only one of the five surplus rows before the ceiling.
		expect(pruneEvents(NOW, limits)).toBe(4);
		expect(remainingIds()).toEqual([5, 6, 7, 8, 9, 10]);
	});
});

describe('pruneErrors', () => {
	it('removes errors not seen within the retention window, whatever their source', () => {
		insertError('old-server', 'server', NOW - 2000);
		insertError('old-client', 'client', NOW - 2000);
		insertError('old-sync', 'sync', NOW - 2000);
		insertError('new-server', 'server', NOW - 500);
		insertError('new-client', 'client', NOW - 500);

		pruneErrors(NOW, { retentionMs: 1000 });

		expect(remainingErrors()).toEqual(['new-client', 'new-server']);
	});

	it('keeps only the most recently seen browser reports', () => {
		for (let i = 0; i < 6; i++) insertError(`client-${i}`, 'client', NOW - i);

		pruneErrors(NOW, { maxClientErrors: 3 });

		expect(remainingErrors()).toEqual(['client-0', 'client-1', 'client-2']);
	});

	it('never caps server or sync errors, however many browser reports there are', () => {
		for (let i = 0; i < 4; i++) insertError(`server-${i}`, 'server', NOW - 1000 - i);
		for (let i = 0; i < 4; i++) insertError(`sync-${i}`, 'sync', NOW - 1000 - i);
		for (let i = 0; i < 4; i++) insertError(`client-${i}`, 'client', NOW - i);

		pruneErrors(NOW, { maxClientErrors: 1 });

		expect(remainingErrors()).toEqual([
			'client-0',
			'server-0',
			'server-1',
			'server-2',
			'server-3',
			'sync-0',
			'sync-1',
			'sync-2',
			'sync-3'
		]);
	});

	it('leaves browser reports alone while they are under the cap', () => {
		for (let i = 0; i < 3; i++) insertError(`client-${i}`, 'client', NOW - i);

		pruneErrors(NOW);

		expect(remainingErrors()).toHaveLength(3);
	});
});

describe('pruneIfDue', () => {
	const MINUTE = 60 * 1000;
	const HOUR = 60 * MINUTE;

	// The schedule lives in the module and outlasts each test's database, so
	// every test starts well clear of wherever the last one left it: its first
	// call is always due.
	let epoch = NOW;
	beforeEach(() => {
		epoch += 30 * 24 * HOUR;
	});

	const limits = { retentionMs: 1000, maxEvents: 1000, pruneBatch: 2, pruneMaxRows: 4 };

	it('prunes when due, then leaves the table alone for six hours', () => {
		insertEvent(epoch - 2000);
		pruneIfDue(epoch, limits);
		expect(remainingIds()).toEqual([]);

		insertEvent(epoch - 2000);
		pruneIfDue(epoch + 6 * HOUR - 1, limits);
		expect(remainingIds()).toHaveLength(1);

		pruneIfDue(epoch + 6 * HOUR, limits);
		expect(remainingIds()).toEqual([]);
	});

	it('comes back in a minute after a pass that hit its ceiling', () => {
		for (let i = 0; i < 7; i++) insertEvent(epoch - 2000);

		pruneIfDue(epoch, limits);
		expect(remainingIds()).toHaveLength(3);

		pruneIfDue(epoch + MINUTE - 1, limits);
		expect(remainingIds()).toHaveLength(3);

		// This pass clears the backlog without reaching the ceiling, so the
		// schedule goes back to six hours.
		pruneIfDue(epoch + MINUTE, limits);
		expect(remainingIds()).toEqual([]);

		insertEvent(epoch - 2000);
		pruneIfDue(epoch + 2 * MINUTE, limits);
		expect(remainingIds()).toHaveLength(1);
	});

	it('trims the errors table on the same pass', () => {
		insertError('old', 'server', epoch - 2000);
		insertError('recent', 'server', epoch - 500);
		for (let i = 0; i < 4; i++) insertError(`client-${i}`, 'client', epoch - i);

		pruneIfDue(epoch, { ...limits, maxClientErrors: 2 });

		expect(remainingErrors()).toEqual(['client-0', 'client-1', 'recent']);
	});
});

describe('recordEdgeViews', () => {
	const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0';

	function view(page: Partial<EventPage> = {}, visitor: Partial<EventVisitor> = {}) {
		return {
			page: {
				pathname: '/game/nhl/TOR',
				routeId: '/[[lang=locale]]/game/[league]/[team]',
				params: { league: 'nhl', team: 'TOR' },
				locale: 'en' as const,
				...page
			},
			visitor: {
				ip: '203.0.113.7',
				userAgent: BROWSER,
				referer: null,
				hostname: 'numbrrs.app',
				...visitor
			}
		};
	}

	function rows() {
		return getDb().select().from(events).orderBy(events.id).all();
	}

	it('writes a pageview for each view and says how many', () => {
		const written = recordEdgeViews([
			view(),
			view({ pathname: '/fr', routeId: '/[[lang=locale]]', params: { lang: 'fr' }, locale: 'fr' })
		]);

		expect(written).toBe(2);
		expect(rows()).toMatchObject([
			{
				name: 'pageview',
				path: '/game/nhl/TOR',
				league: 'nhl',
				team: 'TOR',
				locale: 'en',
				servedBy: 'edge'
			},
			{
				name: 'pageview',
				path: '/fr',
				routeId: '/[[lang=locale]]',
				league: null,
				locale: 'fr',
				servedBy: 'edge'
			}
		]);
	});

	it('leaves the bots out of the count and out of the table', () => {
		const written = recordEdgeViews([
			view({}, { userAgent: 'Mozilla/5.0 (compatible; bingbot/2.0)' }),
			view(),
			view({}, { userAgent: '' })
		]);

		expect(written).toBe(1);
		expect(rows()).toHaveLength(1);
	});

	it('stores what a rendered view stores of a long path, and no more', () => {
		recordEdgeViews([view({ pathname: `/${'a'.repeat(500)}` })]);

		expect(rows()[0]?.path).toHaveLength(200);
	});

	it('gives one visitor one hash across a batch, and across batches', () => {
		recordEdgeViews([view(), view({}, { ip: '203.0.113.8' }), view()]);
		recordEdgeViews([view()]);

		const [first, other, again, later] = rows().map((row) => row.visitorHash);
		expect(again).toBe(first);
		expect(later).toBe(first);
		expect(other).not.toBe(first);
	});

	it('does nothing with an empty batch', () => {
		expect(recordEdgeViews([])).toBe(0);
		expect(rows()).toEqual([]);
	});

	it('writes all of a batch or none of it', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		error.mockClear();

		// The second row breaks a NOT NULL constraint part-way through.
		const written = recordEdgeViews([view(), view({ locale: null as never }), view()]);

		expect(written).toBe(0);
		expect(rows()).toEqual([]);
		expect(error).toHaveBeenCalledTimes(1);
	});

	it('never throws, whatever state the database is in', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		error.mockClear();
		closeDb();

		expect(recordEdgeViews([view()])).toBe(0);
		expect(error).toHaveBeenCalledTimes(1);
	});
});
