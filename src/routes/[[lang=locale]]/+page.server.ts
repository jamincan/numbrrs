import { db } from '$lib/server/db';
import { teams } from '$lib/server/db/schema';
import { ensureTeams } from '$lib/server/leagues';

export async function load() {
	await ensureTeams();
	return { teams: db.select().from(teams).all() };
}
