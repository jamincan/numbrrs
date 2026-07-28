import { env } from '$env/dynamic/private';
import { resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Player, Team } from '$lib/types';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

let instance: Db | undefined;

/**
 * Point the module at a database, migrating it to the current schema.
 * `bootstrap` below calls this with the real file in production; tests call
 * it directly with `new Database(':memory:')` for a real schema with no
 * network and no file on disk.
 */
export function initDb(client: InstanceType<typeof Database>): Db {
	client.pragma('journal_mode = WAL');
	instance = drizzle(client, { schema });
	migrate(instance, { migrationsFolder: resolve('drizzle') });
	return instance;
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
 * A failed migration exits the process instead of leaving `instance` unset:
 * the alternative is every request rendering an opaque 500 with nothing
 * indicating the database never came up. Fly restarts the machine, and the
 * failure shows up in the logs as a boot failure rather than scattered 500s.
 */
export function bootstrap(): void {
	try {
		initDb(new Database(env.DATABASE_URL || 'local.db'));
	} catch (err) {
		console.error('Database migration failed:', err);
		process.exit(1);
	}
}

export type { Player, Team };

// Compile-time proof that the shared types in $lib/types match what the schema
// actually produces: if either side drifts, Equals resolves to false and the
// Expect constraint stops the build.
type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Expect<T extends true> = T;
export type _PlayerMatchesSchema = Expect<Equals<Player, typeof schema.players.$inferSelect>>;
export type _TeamMatchesSchema = Expect<Equals<Team, typeof schema.teams.$inferSelect>>;
