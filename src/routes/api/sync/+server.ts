import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import { tokenMatches } from '$lib/server/admin';
import { syncRostersOnce } from '$lib/server/leagues';
import type { RequestHandler } from './$types';

/**
 * Force a full refresh of every league, ignoring the TTLs that normally keep
 * on-demand syncing cheap. Nothing calls this on a schedule — it's here for
 * pushing new data out immediately.
 *
 *   POST /api/sync            -> starts a sync and returns immediately (202)
 *   POST /api/sync?wait=true  -> waits for the sync to finish before responding
 *
 * Requires an `Authorization: Bearer <SYNC_TOKEN>` header. The endpoint is
 * disabled (503) unless the SYNC_TOKEN secret is configured.
 */
export const POST: RequestHandler = async ({ request, url }) => {
	const token = env.SYNC_TOKEN;
	if (!token) {
		throw error(503, 'Sync endpoint is not configured (SYNC_TOKEN unset)');
	}

	const auth = request.headers.get('authorization') ?? '';
	if (!tokenMatches(auth, `Bearer ${token}`)) {
		throw error(401, 'Unauthorized');
	}

	const { started, done } = syncRostersOnce();

	if (url.searchParams.get('wait') === 'true') {
		try {
			await done;
		} catch (err) {
			console.error('Manual roster sync failed:', err);
			throw error(500, 'Roster sync failed');
		}
		return json({ status: 'completed' });
	}

	// Fire-and-forget: a full sync walks every team in every league and takes a
	// couple of minutes, so don't block the request on it. Prefer ?wait=true when
	// the caller can stay connected — on Fly the machine can be stopped for
	// idleness once this request returns.
	done.catch((err) => console.error('Manual roster sync failed:', err));
	return json({ status: started ? 'started' : 'already-running' }, { status: 202 });
};
