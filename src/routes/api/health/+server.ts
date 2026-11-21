import { getDb } from '#lib/server/db/index.ts';
import { syncState } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

/**
 * A cheap database liveness probe for Fly's health check. `getDb()` throws if
 * the app is running without a working database, and the query itself fails if
 * the file is missing or locked — either way SvelteKit's default error handling
 * turns that into a 500.
 *
 * A failing check does not restart anything. Fly's proxy stops routing requests
 * to a machine whose service check fails and resumes when it passes again; the
 * machine itself keeps running. What this buys is that visitors get the proxy's
 * error instead of a page built on a broken database, and that the failure is
 * visible in `fly checks list`. Getting out of that state takes a restart by
 * hand or a deploy — a database that fails at boot, by contrast, exits the
 * process (see `bootstrap`), and Fly does restart that.
 *
 * Deliberately does not touch the league APIs or the sync path: a health
 * check that can be slowed by an upstream outage turns that outage into a
 * restart loop here too.
 */
export const GET: RequestHandler = () => {
	getDb().select().from(syncState).limit(1).all();
	return Response.json({ status: 'ok' });
};
