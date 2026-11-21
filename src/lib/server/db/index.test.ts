import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { closeDb, databasePath, getDb, initDb } from './index';
import { players, teams } from './schema';

const scratch: string[] = [];

function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'numbrrs-db-'));
	scratch.push(dir);
	return dir;
}

afterEach(() => {
	closeDb();
	for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A migrations folder in drizzle's layout, built from SQL written out here —
 * for the migrations the real folder doesn't contain yet, which is the whole
 * reason the migrator's handling of them needs a test.
 */
function migrationsFolder(migrations: string[][]): string {
	const dir = scratchDir();
	mkdirSync(join(dir, 'meta'));
	const entries = migrations.map((statements, idx) => {
		const tag = `${String(idx).padStart(4, '0')}_fixture`;
		writeFileSync(join(dir, `${tag}.sql`), statements.join('\n--> statement-breakpoint\n'));
		return { idx, version: '6', when: 1_700_000_000_000 + idx, tag, breakpoints: true };
	});
	writeFileSync(
		join(dir, 'meta', '_journal.json'),
		JSON.stringify({ version: '7', dialect: 'sqlite', entries })
	);
	return dir;
}

const CREATE_PARENT_AND_CHILD = [
	'CREATE TABLE `parent` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL);',
	'CREATE TABLE `child` (`id` integer PRIMARY KEY NOT NULL, `parent_id` text NOT NULL, FOREIGN KEY (`parent_id`) REFERENCES `parent`(`id`));'
];

// What drizzle-kit generates to change a column on `parent`: SQLite can't
// alter it in place, so the table is rebuilt and swapped.
const REBUILD_PARENT = [
	'PRAGMA foreign_keys=OFF;',
	'CREATE TABLE `__new_parent` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `extra` text);',
	'INSERT INTO `__new_parent`(`id`, `name`) SELECT `id`, `name` FROM `parent`;',
	'DROP TABLE `parent`;',
	'ALTER TABLE `__new_parent` RENAME TO `parent`;',
	'PRAGMA foreign_keys=ON;'
];

describe('initDb', () => {
	it('applies every migration to an empty database', () => {
		const client = new Database(':memory:');
		initDb(client);

		const tables = client
			.prepare(
				"select name from sqlite_master where type = 'table' and name not like '\\_\\_%' escape '\\' and name not like 'sqlite_%' order by name"
			)
			.pluck()
			.all();
		expect(tables).toEqual(['errors', 'events', 'players', 'sync_state', 'teams']);
		expect(client.pragma('foreign_key_check')).toEqual([]);
	});

	it('is safe to run again on a database that is already current', () => {
		const client = new Database(':memory:');
		initDb(client);
		const applied = () => client.prepare('select count(*) from __drizzle_migrations').pluck().get();
		const before = applied();

		initDb(client);

		expect(applied()).toBe(before);
	});

	it('sets and verifies the connection settings', () => {
		const client = new Database(':memory:');
		initDb(client);

		expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(client.pragma('synchronous', { simple: true })).toBe(1);
		expect(client.pragma('busy_timeout', { simple: true })).toBe(5000);
		expect(client.pragma('journal_size_limit', { simple: true })).toBe(16 * 1024 * 1024);
	});

	it('puts a database file into WAL mode', () => {
		const client = new Database(join(scratchDir(), 'test.db'));
		initDb(client);

		expect(client.pragma('journal_mode', { simple: true })).toBe('wal');
	});

	it('leaves foreign keys enforced once the migration is done', () => {
		initDb(new Database(':memory:'));

		expect(() =>
			getDb()
				.insert(players)
				.values({
					league: 'nhl',
					id: 1,
					teamId: 'nhl:NOPE',
					firstName: 'No',
					lastName: 'Team',
					positionCode: 'C',
					headshotUrl: ''
				})
				.run()
		).toThrow(/FOREIGN KEY/);
	});

	it('reads a roster through the team index rather than scanning players', () => {
		const client = new Database(':memory:');
		initDb(client);

		const plan = client
			.prepare('explain query plan select * from players where team_id = ?')
			.all('nhl:TOR') as { detail: string }[];

		expect(plan.map((row) => row.detail).join('\n')).toContain('players_team_id_idx');
	});

	it('rebuilds a table that populated rows point at', () => {
		const client = new Database(':memory:');
		initDb(client, migrationsFolder([CREATE_PARENT_AND_CHILD]));
		client.exec("insert into parent values ('a', 'A'); insert into child values (1, 'a');");

		// The reason this needs care: run the way the migrator runs it — inside
		// one transaction, where the migration's own pragma is ignored — the
		// rebuild fails as soon as there is a row pointing at the old table.
		expect(() =>
			client.transaction(() => {
				for (const statement of REBUILD_PARENT) client.exec(statement);
			})()
		).toThrow(/FOREIGN KEY/);

		initDb(client, migrationsFolder([CREATE_PARENT_AND_CHILD, REBUILD_PARENT]));

		expect(client.prepare('select * from parent').all()).toEqual([
			{ id: 'a', name: 'A', extra: null }
		]);
		expect(client.prepare('select * from child').all()).toEqual([{ id: 1, parent_id: 'a' }]);
		expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
	});

	it('fails a migration that leaves rows pointing at nothing', () => {
		const client = new Database(':memory:');
		initDb(client, migrationsFolder([CREATE_PARENT_AND_CHILD]));
		client.exec("insert into parent values ('a', 'A'); insert into child values (1, 'a');");
		const before = getDb();

		const orphaning = migrationsFolder([
			CREATE_PARENT_AND_CHILD,
			["DELETE FROM `parent` WHERE `id` = 'a';"]
		]);

		expect(() => initDb(client, orphaning)).toThrow(
			/Foreign key check failed.*child row 1 -> parent/
		);
		// Enforcement is back on whatever happened, and the module is still
		// pointing at the database it had before the failed attempt.
		expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
		expect(getDb()).toBe(before);
	});

	it('starts on a database whose orphaned rows were already there', () => {
		const client = new Database(':memory:');
		const folder = migrationsFolder([CREATE_PARENT_AND_CHILD]);
		initDb(client, folder);
		client.pragma('foreign_keys = OFF');
		client.exec("insert into child values (1, 'gone');");
		client.pragma('foreign_keys = ON');
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});

		// Old damage is reported, not treated as a migration that just failed.
		expect(() => initDb(client, folder)).not.toThrow();
		expect(logged).toHaveBeenCalledWith(expect.stringContaining('child row 1 -> parent'));
		logged.mockRestore();
	});

	it('fails rather than starting on a migration that throws', () => {
		const client = new Database(':memory:');
		const broken = migrationsFolder([
			CREATE_PARENT_AND_CHILD,
			['ALTER TABLE `missing` ADD `x` text;']
		]);

		expect(() => initDb(client, broken)).toThrow();
		// One transaction for the whole batch: the first migration went with it.
		expect(
			client.prepare("select name from sqlite_master where name = 'parent'").get()
		).toBeUndefined();
		expect(client.pragma('foreign_keys', { simple: true })).toBe(1);
	});
});

describe('closeDb', () => {
	it('checkpoints the log into the database file and closes the connection', () => {
		const path = join(scratchDir(), 'test.db');
		const client = new Database(path);
		initDb(client);
		getDb()
			.insert(teams)
			.values({ id: 'nhl:TOR', league: 'nhl', name: 'Toronto', abbreviation: 'TOR', logoUrl: '' })
			.run();
		expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);

		closeDb();

		expect(client.open).toBe(false);
		// Nothing left beside the file that it depends on.
		expect(existsSync(`${path}-wal`) && statSync(`${path}-wal`).size > 0).toBe(false);
		const reopened = new Database(path, { readonly: true });
		expect(reopened.prepare('select id from teams').pluck().all()).toEqual(['nhl:TOR']);
		reopened.close();
	});

	it('can be called twice, and before anything is open', () => {
		closeDb();
		initDb(new Database(':memory:'));

		closeDb();

		expect(() => closeDb()).not.toThrow();
		expect(() => getDb()).toThrow('Database accessed before initialization');
	});

	it('still closes when the checkpoint fails', () => {
		const client = new Database(':memory:');
		initDb(client);
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const pragma = vi.spyOn(client, 'pragma').mockImplementation(() => {
			throw new Error('disk I/O error');
		});

		closeDb();

		pragma.mockRestore();
		expect(error).toHaveBeenCalled();
		expect(client.open).toBe(false);
		error.mockRestore();
	});
});

describe('databasePath', () => {
	it('uses the configured path wherever it runs', () => {
		expect(databasePath('/data/numbrrs.db', true)).toBe('/data/numbrrs.db');
		expect(databasePath('/data/numbrrs.db', false)).toBe('/data/numbrrs.db');
	});

	it('falls back to local.db outside a production build', () => {
		expect(databasePath('', false)).toBe('local.db');
	});

	it('refuses the fallback in a production build', () => {
		expect(() => databasePath('', true)).toThrow(/DATABASE_URL is not set/);
	});
});
