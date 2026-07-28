import { json } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { syncState } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * A cheap database liveness probe for Fly's health check. `getDb()` throws if
 * the app booted without a working database (see ERR-4), and the query itself
 * fails if the file is missing or locked — either way SvelteKit's default
 * error handling turns that into a 500, which is what tells Fly to restart
 * the machine instead of leaving it serving errors indefinitely.
 *
 * Deliberately does not touch the league APIs or the sync path: a health
 * check that can be slowed by an upstream outage turns that outage into a
 * restart loop here too.
 */
export const GET: RequestHandler = () => {
	getDb().select().from(syncState).limit(1).all();
	return json({ status: 'ok' });
};
