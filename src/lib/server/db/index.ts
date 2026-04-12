import { building } from "$app/environment";
import { env } from "$env/dynamic/private";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export let db: ReturnType<typeof drizzle<typeof schema>>;

if (!building) {
  const client = new Database(env.DATABASE_URL || "local.db");
  client.pragma("journal_mode = WAL");
  db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: resolve("drizzle") });
}

export type Player = typeof schema.players.$inferSelect;
export type Team = typeof schema.teams.$inferSelect;
