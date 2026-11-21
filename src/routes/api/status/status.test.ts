import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebhookHealth } from '#lib/server/alerts.ts';
import { closeDb, getDb, initDb } from '#lib/server/db/index.ts';
import { players, syncState, teams } from '#lib/server/db/schema.ts';
import { ROSTER_TTL } from '#lib/server/leagues/index.ts';

const webhook = vi.hoisted(() => ({
	health: { configured: false, last: null } as WebhookHealth
}));

// Only the getter is replaced. The rest of the module is the real one, and with
// no webhook URL in the test environment it has nothing to post to.
vi.mock('#lib/server/alerts.ts', async (importOriginal) => ({
	...(await importOriginal<typeof import('#lib/server/alerts.ts')>()),
	webhookHealth: () => webhook.health
}));

const { GET } = await import('./+server.ts');
const { WRITE_PROBE_KEY, buildStatus, currentStatus } = await import('./report.ts');

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

let client: InstanceType<typeof Database>;

function addTeam(code: string, rosterSyncedAt: number | null, withPlayers = true): void {
	const id = `nhl:${code}`;
	getDb()
		.insert(teams)
		.values({
			id,
			league: 'nhl',
			name: `Team ${code}`,
			abbreviation: code,
			logoUrl: 'https://example.invalid/logo.svg',
			rosterSyncedAt
		})
		.run();
	if (!withPlayers) return;
	getDb()
		.insert(players)
		.values({
			league: 'nhl',
			id: getDb().select().from(players).all().length + 1,
			teamId: id,
			firstName: 'A',
			lastName: 'B',
			sweaterNumber: 1,
			positionCode: 'C',
			headshotUrl: 'https://example.invalid/a.png'
		})
		.run();
}

function probeRows() {
	return getDb().select().from(syncState).all();
}

beforeEach(() => {
	client = new Database(':memory:');
	initDb(client);
	webhook.health = { configured: false, last: null };
	// A failing check logs why; the tests that make one fail on purpose would
	// otherwise fill the output with it.
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('buildStatus', () => {
	it('reports every check passing on a working database', () => {
		const report = buildStatus(NOW);

		expect(report.ok).toBe(true);
		expect(report.at).toBe(NOW);
		expect(typeof report.build).toBe('string');
		expect(report.checks.database).toEqual({ ok: true });
		expect(report.checks.write).toEqual({ ok: true });
		expect(report.checks.rosters).toEqual({
			ok: true,
			teams: 0,
			stale: 0,
			oldestAgeSeconds: null,
			ttlSeconds: ROSTER_TTL / 1000
		});
	});

	it('gives a boot time that does not move between reports', () => {
		const first = buildStatus(NOW);
		const second = buildStatus(NOW + 5 * 60 * 1000);

		expect(second.process.bootedAt).toBe(first.process.bootedAt);
		expect(first.process.bootedAt).toBeLessThanOrEqual(Date.now());
		expect(first.process.bootedAt % 1000).toBe(0);
	});

	it('rewrites one fixed row, however often it runs', () => {
		buildStatus(NOW);
		buildStatus(NOW + 1000);
		buildStatus(NOW + 2000);

		expect(probeRows()).toEqual([
			{ key: WRITE_PROBE_KEY, syncedAt: NOW + 2000, failedAt: null, failureCount: 0 }
		]);
	});

	it('reports a database that reads but will not take a write', () => {
		addTeam('TOR', NOW - HOUR);
		client.pragma('query_only = ON');

		const report = buildStatus(NOW);

		expect(report.ok).toBe(false);
		expect(report.checks.write).toEqual({ ok: false });
		expect(report.checks.database).toEqual({ ok: true });
		expect(report.checks.rosters).toMatchObject({ ok: true, teams: 1 });
	});

	it('still answers when there is no database at all', () => {
		closeDb();

		const report = buildStatus(NOW);

		expect(report.ok).toBe(false);
		expect(report.checks.database).toEqual({ ok: false });
		expect(report.checks.write).toEqual({ ok: false });
		expect(report.checks.rosters).toEqual({ ok: false });
		expect(report.checks.alerts).toMatchObject({ ok: true });
		expect(report.process.uptimeSeconds).toBeGreaterThanOrEqual(0);
	});

	it("ages the oldest synced roster and counts stale teams by the sync layer's rule", () => {
		addTeam('TOR', NOW - HOUR);
		addTeam('MTL', NOW - 5 * HOUR);
		// Past the TTL.
		addTeam('OTT', NOW - ROSTER_TTL - HOUR);
		// Never synced: stale, and no age to contribute.
		addTeam('BOS', null, false);
		// Synced a moment ago but holding nobody, which the sweep treats as stale.
		addTeam('NYR', NOW - 1000, false);
		vi.spyOn(Date, 'now').mockReturnValue(NOW);

		expect(buildStatus(NOW).checks.rosters).toEqual({
			ok: true,
			teams: 5,
			stale: 3,
			oldestAgeSeconds: (ROSTER_TTL + HOUR) / 1000,
			ttlSeconds: ROSTER_TTL / 1000
		});
	});

	it('has no disk to measure for an in-memory database', () => {
		expect(buildStatus(NOW, ':memory:').checks.disk).toEqual({
			ok: true,
			freeBytes: null,
			totalBytes: null,
			freePercent: null,
			databaseBytes: null
		});
	});

	describe('with a database file', () => {
		let dir: string;

		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), 'numbrrs-status-'));
		});

		afterEach(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		it("measures the file and the free space on the file's volume", () => {
			const file = join(dir, 'numbrrs.db');
			writeFileSync(file, 'x'.repeat(4096));

			const { disk } = buildStatus(NOW, file).checks;

			if (!disk.ok) throw new Error('disk check failed');
			expect(disk.databaseBytes).toBe(4096);
			expect(disk.totalBytes).toBeGreaterThan(0);
			expect(disk.freeBytes).toBeGreaterThanOrEqual(0);
			expect(disk.freeBytes).toBeLessThanOrEqual(disk.totalBytes!);
			expect(disk.freePercent).toBeGreaterThanOrEqual(0);
			expect(disk.freePercent).toBeLessThanOrEqual(100);
		});

		it('fails only the disk check when the file is not there, and says nothing of where', () => {
			const report = buildStatus(NOW, join(dir, 'missing.db'));

			expect(report.ok).toBe(false);
			expect(report.checks.disk).toEqual({ ok: false });
			expect(report.checks.database).toEqual({ ok: true });
			expect(report.checks.write).toEqual({ ok: true });

			const body = JSON.stringify(report);
			expect(body).not.toContain('missing.db');
			expect(body).not.toContain('numbrrs-status-');
			expect(body).not.toContain('ENOENT');
		});
	});

	it('reports whether alerts are configured and whether the last one was delivered', () => {
		expect(buildStatus(NOW).checks.alerts).toEqual({
			ok: true,
			configured: false,
			lastPostOk: null,
			lastPostAgeSeconds: null
		});

		webhook.health = {
			configured: true,
			last: { at: NOW - 90_000, ok: false, detail: 'HTTP 404 https://discord.test/secret' }
		};
		const report = buildStatus(NOW);

		expect(report.checks.alerts).toEqual({
			ok: true,
			configured: true,
			lastPostOk: false,
			lastPostAgeSeconds: 90
		});
		// The detail can quote what Discord or the network said; the outcome is
		// all that is public.
		expect(JSON.stringify(report)).not.toContain('discord');
	});
});

describe('currentStatus', () => {
	it('reuses a report for ten seconds, then builds a new one', () => {
		const at = NOW + 10 * HOUR;
		const first = currentStatus(at);
		addTeam('TOR', at);

		expect(currentStatus(at + 9_999)).toBe(first);
		expect(probeRows()).toMatchObject([{ syncedAt: at }]);

		const later = currentStatus(at + 10_000);
		expect(later.at).toBe(at + 10_000);
		expect(later.checks.rosters).toMatchObject({ teams: 1 });
	});

	it('does not keep serving a report from the future when the clock steps back', () => {
		const at = NOW + 20 * HOUR;
		currentStatus(at);

		expect(currentStatus(at - HOUR).at).toBe(at - HOUR);
	});
});

describe('GET /api/status', () => {
	it('answers 200 with the report and forbids storing it', async () => {
		const response = GET({} as Parameters<typeof GET>[0]) as Response;

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toContain('no-store');
		expect(response.headers.get('content-type')).toContain('application/json');
		const body = (await response.json()) as { ok: boolean; checks: Record<string, unknown> };
		expect(Object.keys(body.checks)).toEqual(['database', 'write', 'disk', 'rosters', 'alerts']);
	});

	it('answers 200 with a failing report when the database is gone', async () => {
		// Far enough on that the report the test above left behind has expired.
		vi.spyOn(Date, 'now').mockReturnValue(Date.now() + HOUR);
		closeDb();

		const response = GET({} as Parameters<typeof GET>[0]) as Response;

		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ok: false,
			checks: { database: { ok: false }, write: { ok: false } }
		});
	});
});
