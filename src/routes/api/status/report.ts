import { statSync, statfsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { version } from '$app/env';
import { webhookHealth } from '#lib/server/alerts.ts';
import { databasePath, getDb } from '#lib/server/db/index.ts';
import { syncState, teams } from '#lib/server/db/schema.ts';
import { ROSTER_TTL, isRosterStale } from '#lib/server/leagues/index.ts';

/**
 * What the uptime probe reads (cloudflare/uptime-worker.ts): the facts about
 * this machine that `/api/health` cannot give it, because that one only proves
 * the database can be read.
 *
 * Anyone can ask for this, so it holds nothing worth keeping from them: sizes,
 * ages and yes/no answers. No paths, no error text, no addresses, nothing about
 * visitors. Why a check failed goes to the server's log instead.
 *
 * Facts, not verdicts. A check's `ok` says that it ran and that the thing it
 * touches works; whether 9% free disk or a 14-hour-old roster is a problem is
 * the probe's decision, so that the thresholds live in one place.
 */
export interface StatusReport {
	/** Every check ran and passed. */
	ok: boolean;
	/** When this report was built, epoch ms. */
	at: number;
	/** SvelteKit's build id — by default the time of the build, not a commit. */
	build: string;
	process: {
		/** Epoch ms, fixed for the life of the process: a new value means a restart. */
		bootedAt: number;
		uptimeSeconds: number;
	};
	checks: {
		database: Check<object>;
		write: Check<object>;
		disk: Check<DiskUsage>;
		rosters: Check<RosterAges>;
		alerts: Check<AlertDelivery>;
	};
}

type Check<T> = ({ ok: true } & T) | { ok: false };

/** All null when the database is in memory and so has no volume to fill. */
interface DiskUsage {
	freeBytes: number | null;
	totalBytes: number | null;
	freePercent: number | null;
	databaseBytes: number | null;
}

interface RosterAges {
	teams: number;
	/** Teams the next sweep would refresh, by the sync layer's own rule. */
	stale: number;
	/** Age of the least recently synced roster; null when none has synced yet. */
	oldestAgeSeconds: number | null;
	/** How old a roster may get before the sweep refreshes it. */
	ttlSeconds: number;
}

interface AlertDelivery {
	configured: boolean;
	/** The last post to the webhook since boot; null when there has been none. */
	lastPostOk: boolean | null;
	lastPostAgeSeconds: number | null;
}

/**
 * Whole seconds, so that it comes out the same however long after boot this
 * module is first loaded. The probe counts a change in it as a restart.
 */
const BOOTED_AT = Math.round((Date.now() - process.uptime() * 1000) / 1000) * 1000;

/**
 * The one row the write probe rewrites. It shares `sync_state` with the sync
 * layer, which only ever looks up keys it built itself (`teams:…`, `roster:…`),
 * so a key of another shape is invisible to it.
 */
export const WRITE_PROBE_KEY = 'status:write-probe';

/**
 * How long a report is reused. The endpoint is public, exempt from the
 * per-address limit, and writes to the database, so without this anyone could
 * turn requests into writes at whatever rate they liked. The probe asks every
 * five minutes and never notices.
 */
const REUSE_MS = 10_000;

function check<T extends object>(name: string, run: () => T): Check<T> {
	try {
		return { ok: true, ...run() };
	} catch (err) {
		// Here and not in the response: the text of a database or filesystem
		// error names paths.
		console.error(`[status] ${name} check failed:`, err);
		return { ok: false };
	}
}

function readDatabase(): object {
	getDb().select({ key: syncState.key }).from(syncState).limit(1).all();
	return {};
}

/**
 * A committed write, because nothing short of one notices a database that has
 * stopped taking them: a read-only remount or a corrupt page leaves every read
 * working. It rewrites a single fixed row, so however often it runs the
 * database is one row bigger than it would otherwise be and no more.
 *
 * It does not prove there is room left. SQLite reuses the space its log
 * already holds, so a small write can succeed on a volume with nothing free;
 * the disk check is what measures that.
 */
function writeDatabase(now: number): object {
	getDb()
		.insert(syncState)
		.values({ key: WRITE_PROBE_KEY, syncedAt: now, failedAt: null, failureCount: 0 })
		.onConflictDoUpdate({ target: syncState.key, set: { syncedAt: now } })
		.run();
	return {};
}

function diskUsage(path: string): DiskUsage {
	if (path === ':memory:') {
		return { freeBytes: null, totalBytes: null, freePercent: null, databaseBytes: null };
	}
	const file = resolve(path);
	// `bavail` rather than `bfree`: what a process without root's reserve could
	// still write, which is the lower and safer of the two.
	const fs = statfsSync(dirname(file));
	const totalBytes = fs.blocks * fs.bsize;
	const freeBytes = fs.bavail * fs.bsize;
	return {
		freeBytes,
		totalBytes,
		freePercent: totalBytes > 0 ? Math.round((freeBytes / totalBytes) * 1000) / 10 : null,
		databaseBytes: statSync(file).size
	};
}

/**
 * How stale the rosters are, which is the only outside view of whether the
 * hourly sweep is still running: once it stops, the oldest roster ages past
 * the TTL and keeps going. Staleness is `isRosterStale`'s answer, the same one
 * the sweep and the admin page use.
 *
 * One read of `teams` and an indexed lookup per team, on tables of about a
 * hundred rows.
 */
function rosterAges(now: number): RosterAges {
	const rows = getDb()
		.select({ id: teams.id, rosterSyncedAt: teams.rosterSyncedAt })
		.from(teams)
		.all();
	const synced = rows.flatMap((row) => (row.rosterSyncedAt === null ? [] : [row.rosterSyncedAt]));
	return {
		teams: rows.length,
		stale: rows.filter(isRosterStale).length,
		oldestAgeSeconds:
			synced.length > 0 ? Math.max(0, Math.round((now - Math.min(...synced)) / 1000)) : null,
		ttlSeconds: ROSTER_TTL / 1000
	};
}

function alertDelivery(now: number): AlertDelivery {
	const { configured, last } = webhookHealth();
	return {
		configured,
		lastPostOk: last ? last.ok : null,
		lastPostAgeSeconds: last ? Math.max(0, Math.round((now - last.at) / 1000)) : null
	};
}

/**
 * Build a report from scratch. Each check stands alone: one that throws is
 * reported as failed and the rest still answer, since the moment something is
 * broken is exactly when this endpoint has to keep talking.
 */
export function buildStatus(now: number, path?: string): StatusReport {
	const checks: StatusReport['checks'] = {
		database: check('database', readDatabase),
		write: check('write', () => writeDatabase(now)),
		// The path is resolved inside the check, because a build with no
		// DATABASE_URL throws there.
		disk: check('disk', () => diskUsage(path ?? databasePath())),
		rosters: check('rosters', () => rosterAges(now)),
		alerts: check('alerts', () => alertDelivery(now))
	};
	return {
		ok: Object.values(checks).every((result) => result.ok),
		at: now,
		build: version,
		process: {
			bootedAt: BOOTED_AT,
			uptimeSeconds: Math.max(0, Math.round((now - BOOTED_AT) / 1000))
		},
		checks
	};
}

let latest: StatusReport | undefined;

/** The report to serve: the last one built, if it is recent enough. */
export function currentStatus(now = Date.now()): StatusReport {
	// A clock that has gone backwards makes the stored report look like it is
	// from the future; rebuilding is the answer that cannot serve it forever.
	if (!latest || now - latest.at >= REUSE_MS || now < latest.at) latest = buildStatus(now);
	return latest;
}
