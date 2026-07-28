import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { initDb, getDb } from './db';
import { events } from './db/schema';
import { deleteOldestEvents, pruneEvents } from './analytics';
import { lt } from 'drizzle-orm';

const NOW = 1_800_000_000_000;

function insertEvent(at: number): number {
	const [row] = getDb()
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
	return row.id;
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

describe('deleteOldestEvents', () => {
	it('deletes the oldest matching rows first, by id', () => {
		for (let i = 0; i < 5; i++) insertEvent(NOW);

		const went = deleteOldestEvents(lt(events.at, NOW + 1), 3);

		expect(went).toBe(3);
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
});
