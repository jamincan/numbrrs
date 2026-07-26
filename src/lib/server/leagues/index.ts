import { db } from '../db';
import { teams, players } from '../db/schema';
import { and, eq, notInArray } from 'drizzle-orm';
import { teamDbId } from '$lib/leagues';
import { nhlAdapter } from './nhl';
import { pwhlAdapter } from './pwhl';
import type { LeagueAdapter } from './types';

const ADAPTERS: LeagueAdapter[] = [nhlAdapter, pwhlAdapter];

let inFlight: Promise<void> | null = null;

/**
 * Run a roster sync, coalescing concurrent callers onto a single run so a
 * manual trigger can't overlap the automatic hourly sync. Returns whether this
 * call started a new sync or joined one already in progress.
 */
export function syncRostersOnce(): { started: boolean; done: Promise<void> } {
	if (inFlight) return { started: false, done: inFlight };
	inFlight = syncRosters().finally(() => {
		inFlight = null;
	});
	return { started: true, done: inFlight };
}

export async function syncRosters(): Promise<void> {
	for (const adapter of ADAPTERS) {
		await syncLeague(adapter);
	}
}

function deleteTeam(league: string, dbId: string) {
	db.transaction((tx) => {
		tx.delete(players)
			.where(and(eq(players.league, league), eq(players.teamId, dbId)))
			.run();
		tx.delete(teams).where(eq(teams.id, dbId)).run();
	});
}

async function syncLeague(adapter: LeagueAdapter): Promise<void> {
	console.log(`Syncing ${adapter.id.toUpperCase()} rosters...`);

	let leagueTeams;
	try {
		leagueTeams = await adapter.fetchTeams();
	} catch (err) {
		console.error(`Failed to fetch ${adapter.id} teams:`, err);
		return;
	}
	if (leagueTeams.length === 0) {
		// Don't wipe the league over a flaky/empty response.
		console.error(`${adapter.id} returned no teams; skipping sync`);
		return;
	}

	// Remove teams (relocations, contractions) no longer reported by the league.
	const activeIds = leagueTeams.map((t) => teamDbId(adapter.id, t.code));
	db.transaction((tx) => {
		tx.delete(players)
			.where(and(eq(players.league, adapter.id), notInArray(players.teamId, activeIds)))
			.run();
		tx.delete(teams)
			.where(and(eq(teams.league, adapter.id), notInArray(teams.id, activeIds)))
			.run();
	});

	const queue = [...leagueTeams];
	let i = 0;

	while (queue.length > 0) {
		if (i > 0) await new Promise((r) => setTimeout(r, 400));
		i++;

		const team = queue.shift()!;
		const dbId = teamDbId(adapter.id, team.code);
		const result = await adapter.fetchRoster(team);

		if (!result.ok) {
			if (!result.notFound) {
				// 429 — requeue after the retry delay
				await new Promise((r) => setTimeout(r, result.retryAfter));
				queue.push(team);
			} else {
				// Non-429 failure — team not found, remove from DB
				deleteTeam(adapter.id, dbId);
			}
			continue;
		}

		const rosterPlayers = result.players;
		const rosterIds = rosterPlayers.map((p) => p.id);

		db.transaction((tx) => {
			tx.insert(teams)
				.values({
					id: dbId,
					league: adapter.id,
					name: team.name,
					abbreviation: team.code,
					logoUrl: team.logoUrl
				})
				.onConflictDoUpdate({
					target: teams.id,
					set: {
						name: team.name,
						logoUrl: team.logoUrl
					}
				})
				.run();

			for (const p of rosterPlayers) {
				// Players without a sweater number are still stored (with a null
				// number); the game treats them as already-identified.
				tx.insert(players)
					.values({
						league: adapter.id,
						id: p.id,
						teamId: dbId,
						firstName: p.firstName,
						lastName: p.lastName,
						sweaterNumber: p.sweaterNumber,
						positionCode: p.positionCode,
						headshotUrl: p.headshotUrl
					})
					.onConflictDoUpdate({
						target: [players.league, players.id],
						set: {
							teamId: dbId,
							firstName: p.firstName,
							lastName: p.lastName,
							sweaterNumber: p.sweaterNumber,
							positionCode: p.positionCode,
							headshotUrl: p.headshotUrl
						}
					})
					.run();
			}

			// Remove players who are no longer on this team's roster (trades,
			// waivers, call-ups/downs). Scoped to teamId so a player who moved to
			// another team isn't deleted here — their new team's sync owns them.
			tx.delete(players)
				.where(
					rosterIds.length > 0
						? and(eq(players.teamId, dbId), notInArray(players.id, rosterIds))
						: eq(players.teamId, dbId)
				)
				.run();
		});
	}

	console.log(`${adapter.id.toUpperCase()} roster sync complete`);
}
