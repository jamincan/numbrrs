import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { players, teams } from '$lib/server/db/schema';
import { isLeagueId, teamDbId } from '$lib/leagues';

export function load({ params }) {
	if (!isLeagueId(params.league)) throw error(404, 'League not found');
	const id = teamDbId(params.league, params.team);
	const team = db.select().from(teams).where(eq(teams.id, id)).get();
	if (!team) throw error(404, 'Team not found');
	const roster = db.select().from(players).where(eq(players.teamId, id)).all();
	return { team, roster };
}
