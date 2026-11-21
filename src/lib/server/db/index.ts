import { dev } from '$app/env';
import { DATABASE_URL } from '$app/env/private';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Player, Team } from '#lib/types.ts';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;
type Client = InstanceType<typeof Database>;

let instance: Db | undefined;
let connection: Client | undefined;

/** How long a statement waits on a lock held by another connection before failing. */
const BUSY_TIMEOUT_MS = 5000;

/**
 * Ceiling on the write-ahead log file once a checkpoint has emptied it. SQLite
 * reuses the file rather than shrinking it, so without a limit one burst of
 * writes, or one checkpoint held up by a long read, sets its size for good.
 * Several times the 4mb the log reaches between automatic checkpoints, so
 * ordinary traffic never pays for a truncate.
 */
const JOURNAL_SIZE_LIMIT = 16 * 1024 * 1024;

/**
 * Connection settings, stated rather than inherited. Every one of these has a
 * default somewhere (SQLite's, or better-sqlite3's build flags and constructor),
 * and a default is only a promise until a driver upgrade changes it.
 *
 * `synchronous = NORMAL` is the setting meant for WAL: the database cannot be
 * corrupted by a crash or power cut, and what a power cut can cost is the last
 * few commits, since the log is synced at checkpoints instead of on every
 * write. Those commits are page-view rows and roster refreshes, both of which
 * this app can lose, and in exchange a request does not wait on a disk sync for
 * each event it records. It is also what better-sqlite3 gives a database that
 * is already in WAL mode when opened, so stating it changes nothing in
 * production; it stops a fresh file from starting out on FULL.
 */
function configure(client: Client): void {
	client.pragma('journal_mode = WAL');
	client.pragma('synchronous = NORMAL');
	client.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
	client.pragma(`journal_size_limit = ${JOURNAL_SIZE_LIMIT}`);
	client.pragma('foreign_keys = ON');
}

/**
 * Read the settings back. A pragma SQLite cannot honour is not an error, it is
 * silently ignored — `foreign_keys` inside a transaction, WAL on a filesystem
 * without shared memory — so setting one proves nothing about what is in force.
 */
function assertConfigured(client: Client): void {
	const expected: Record<string, unknown> = {
		// An in-memory database has no file to log to and reports its own mode.
		journal_mode: client.memory ? 'memory' : 'wal',
		synchronous: 1,
		busy_timeout: BUSY_TIMEOUT_MS,
		journal_size_limit: JOURNAL_SIZE_LIMIT,
		foreign_keys: 1
	};
	for (const [name, want] of Object.entries(expected)) {
		const got = client.pragma(name, { simple: true });
		if (got !== want) {
			throw new Error(`SQLite ${name} is ${String(got)}, expected ${String(want)}`);
		}
	}
}

interface ForeignKeyViolation {
	table: string;
	rowid: number | null;
	parent: string;
	fkid: number;
}

/** Rows pointing at a parent that isn't there, keyed so two checks can be compared. */
function foreignKeyViolations(client: Client): Map<string, ForeignKeyViolation> {
	const rows = client.pragma('foreign_key_check') as ForeignKeyViolation[];
	return new Map(rows.map((v) => [`${v.table}:${v.rowid ?? '?'}:${v.parent}:${v.fkid}`, v]));
}

function sample(violations: Map<string, ForeignKeyViolation>): string {
	return [...violations.values()]
		.slice(0, 5)
		.map((v) => `${v.table} row ${v.rowid ?? '?'} -> ${v.parent}`)
		.join('; ');
}

/**
 * Bring the schema up to date, with foreign-key enforcement off while it runs
 * and the result checked afterwards.
 *
 * SQLite changes a table by rebuilding it: create the new one, copy the rows,
 * drop the old, rename. With enforcement on, dropping a table other rows point
 * at fails — so a rebuild of `teams` works against an empty database and fails
 * against one with players in it. drizzle-kit knows this and writes
 * `PRAGMA foreign_keys=OFF` into such a migration, but the migrator runs every
 * pending migration inside one transaction, and that pragma does nothing inside
 * a transaction. It has to be set out here, before the transaction opens.
 *
 * Enforcement being off also means a migration can leave rows pointing at
 * nothing. `foreign_key_check` finds them, and any the migration added fail the
 * boot. Ones that were already there do not: they are logged, because refusing
 * to start over rows that have been sitting in the database would turn old,
 * harmless damage into an outage at the next deploy.
 */
function migrateSchema(client: Client, db: Db, migrationsFolder: string): void {
	client.pragma('foreign_keys = OFF');
	try {
		if (client.pragma('foreign_keys', { simple: true }) !== 0) {
			throw new Error('Could not turn foreign-key enforcement off for the migration');
		}
		const existing = foreignKeyViolations(client);
		if (existing.size > 0) {
			console.error(
				`[db] ${existing.size} row(s) already reference a missing parent (${sample(existing)})`
			);
		}

		migrate(db, { migrationsFolder });

		const added = foreignKeyViolations(client);
		for (const key of existing.keys()) added.delete(key);
		if (added.size > 0) {
			throw new Error(
				`Foreign key check failed after migrating: ${added.size} row(s) reference a missing parent (${sample(added)})`
			);
		}
	} finally {
		client.pragma('foreign_keys = ON');
	}
}

/**
 * Point the module at a database, migrating it to the current schema.
 * `bootstrap` below calls this with the real file in production; tests call
 * it directly with `new Database(':memory:')` for a real schema with no
 * network and no file on disk.
 *
 * The module only switches to the new database once it is configured, migrated
 * and checked, so a failure here never leaves a half-prepared one in use.
 */
export function initDb(client: Client, migrationsFolder = resolve('drizzle')): Db {
	configure(client);
	const db = drizzle(client, { schema });
	migrateSchema(client, db, migrationsFolder);
	assertConfigured(client);

	instance = db;
	connection = client;
	return db;
}

/**
 * Fold the write-ahead log back into the database file and close it. Called on
 * shutdown, so the file on the volume is complete on its own — which is what a
 * volume snapshot or a copy of that one file captures — instead of depending on
 * a log beside it being replayed at the next boot.
 *
 * Safe to call twice, or before anything was opened. Afterwards `getDb()`
 * throws, the same as before `initDb`.
 */
export function closeDb(): void {
	const client = connection;
	if (!client) return;
	connection = undefined;
	instance = undefined;

	try {
		client.pragma('wal_checkpoint(TRUNCATE)');
	} catch (err) {
		// Closing matters more than the checkpoint: SQLite checkpoints again when
		// the last connection closes.
		console.error('[db] checkpoint before close failed:', err);
	}
	client.close();
}

/**
 * The active database. Throws rather than returning `undefined` if nothing
 * has called `initDb` yet — reachable during `vite build` (see `bootstrap`)
 * or from a test that forgot setup. A loud throw beats a silent `undefined`
 * that only fails once something tries to call a method on it.
 */
export function getDb(): Db {
	if (!instance) throw new Error('Database accessed before initialization');
	return instance;
}

/**
 * Open the real database and migrate it. Called once from `hooks.server.ts`,
 * guarded there by `building` — the native binding and a schema migration
 * have no business running during `vite build`, which imports server modules
 * to prerender pages.
 *
 * A database that won't open, configure or migrate exits the process instead
 * of leaving `instance` unset: the alternative is every request rendering an
 * opaque 500 with nothing indicating the database never came up. Fly restarts
 * the machine, and the failure shows up in the logs as a boot failure rather
 * than scattered 500s.
 */
export function bootstrap(): void {
	try {
		const path = databasePath();
		// Logged so the answer to "which file is this machine actually using" is
		// in the boot output rather than inferred from configuration.
		console.log(`[db] opening ${path === ':memory:' ? path : resolve(path)}`);
		initDb(new Database(path));
	} catch (err) {
		console.error('Database failed to start:', err);
		process.exit(1);
	}
}

/**
 * Where the database lives. Without `DATABASE_URL` that is `local.db` in the
 * working directory, which is what local development and the tooling expect.
 *
 * A production build refuses that fallback. On Fly the working directory is
 * the container's own disk, not the volume: the app would boot, sync, serve
 * and look healthy, then start from nothing at the next deploy — and the real
 * database would sit untouched on the volume while nobody noticed. Failing to
 * boot is the visible version of the same misconfiguration.
 */
export function databasePath(url: string | undefined = DATABASE_URL, production = !dev): string {
	if (url) return url;
	if (production) {
		throw new Error(
			'DATABASE_URL is not set. Refusing to fall back to local.db in a production build: it would be created on ephemeral disk and lost at the next deploy.'
		);
	}
	return 'local.db';
}

export type { Player };

// Compile-time proof that the shared types in #lib/types match what the schema
// actually produces: if either side drifts, Equals resolves to false and the
// Expect constraint stops the build.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
export type _PlayerMatchesSchema = Expect<Equals<Player, typeof schema.players.$inferSelect>>;
export type _TeamMatchesSchema = Expect<Equals<Team, typeof schema.teams.$inferSelect>>;
