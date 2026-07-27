import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { dayKey } from '$lib/server/telemetry';
import {
	endSession,
	isAuthenticated,
	loginDelay,
	startSession,
	tokenMatches
} from '$lib/server/admin';
import { db } from '$lib/server/db';
import { errors, events, syncState, teams } from '$lib/server/db/schema';
import { ROSTER_TTL, fullSyncStatus, syncRostersOnce } from '$lib/server/leagues';
import { LEAGUES } from '$lib/leagues';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/**
 * Roster freshness per league, plus how far a running sync has got. Progress is
 * measured against the current run's start time rather than a counter the sync
 * keeps: the sync is fire-and-forget and the machine can restart under it, and
 * a timestamp already in the database survives that where a counter wouldn't.
 */
function syncPanel() {
	const status = fullSyncStatus();
	const now = Date.now();

	const listSyncedAt = new Map(
		db
			.select()
			.from(syncState)
			.all()
			.map((s) => [s.key, s.syncedAt])
	);

	const leagues = LEAGUES.map((league) => {
		const rows = db
			.select({ rosterSyncedAt: teams.rosterSyncedAt })
			.from(teams)
			.where(eq(teams.league, league.id))
			.all();

		const synced = rows.filter((r) => r.rosterSyncedAt != null).map((r) => r.rosterSyncedAt!);
		return {
			id: league.id,
			label: league.label.en,
			teams: rows.length,
			// Never-synced teams count as stale, which is why this tests the
			// timestamp rather than filtering nulls out first.
			stale: rows.filter((r) => r.rosterSyncedAt == null || r.rosterSyncedAt < now - ROSTER_TTL)
				.length,
			// Only meaningful once every team has been synced at least once —
			// otherwise "oldest" would quietly ignore the ones that have no
			// timestamp at all. The stale count covers those.
			oldestRoster: synced.length === rows.length && synced.length > 0 ? Math.min(...synced) : null,
			teamListSyncedAt: listSyncedAt.get(`teams:${league.id}`) ?? null,
			done: status.startedAt
				? rows.filter((r) => r.rosterSyncedAt != null && r.rosterSyncedAt >= status.startedAt!)
						.length
				: 0
		};
	});

	return {
		running: status.running,
		startedAt: status.startedAt,
		leagues,
		totalTeams: leagues.reduce((sum, l) => sum + l.teams, 0),
		totalDone: leagues.reduce((sum, l) => sum + l.done, 0)
	};
}

/**
 * Distinct visitor hashes only mean something inside a single day — the salt
 * behind them rotates at midnight, so the same person is a different hash
 * tomorrow. Every "visitors" number here is therefore computed per day and then
 * summed, which counts a daily regular once per day they showed up. That's the
 * honest reading of the data, and the dashboard says so rather than presenting
 * it as a unique-people count.
 */
function stats() {
	const now = Date.now();
	const today = dayKey(now);
	const since = dayKey(now - WINDOW_DAYS * DAY_MS);
	const pageviews = eq(events.name, 'pageview');
	const inWindow = and(pageviews, gte(events.day, since));

	const daily = db
		.select({
			day: events.day,
			views: sql<number>`count(*)`,
			visitors: sql<number>`count(distinct ${events.visitorHash})`
		})
		.from(events)
		.where(inWindow)
		.groupBy(events.day)
		.orderBy(desc(events.day))
		.all();

	const byDay = new Map(daily.map((d) => [d.day, d]));
	const recent = (days: number) => {
		const cutoff = dayKey(now - days * DAY_MS);
		const rows = daily.filter((d) => d.day > cutoff);
		return {
			views: rows.reduce((sum, d) => sum + d.views, 0),
			visitors: rows.reduce((sum, d) => sum + d.visitors, 0),
			// Days with traffic, so an average isn't dragged down by days the app
			// simply wasn't posted anywhere.
			activeDays: rows.length
		};
	};

	// Team names rather than bare codes. Read from the teams table instead of
	// stored on the event, so a rename shows up retroactively and the events
	// table stays free of anything it can derive.
	const teamNames = new Map(
		db
			.select({ id: teams.id, name: teams.name })
			.from(teams)
			.all()
			.map((t) => [t.id, t.name])
	);

	const topTeams = db
		.select({
			league: events.league,
			team: events.team,
			views: sql<number>`count(*)`
		})
		.from(events)
		.where(and(inWindow, isNotNull(events.team)))
		.groupBy(events.league, events.team)
		.orderBy(desc(sql`count(*)`))
		.limit(12)
		.all()
		.map((row) => ({
			...row,
			name: teamNames.get(`${row.league}:${row.team}`) ?? `${row.league}:${row.team}`
		}));

	const topLeagues = db
		.select({ league: events.league, views: sql<number>`count(*)` })
		.from(events)
		.where(and(inWindow, isNotNull(events.league)))
		.groupBy(events.league)
		.orderBy(desc(sql`count(*)`))
		.all();

	const referrers = db
		.select({ host: events.referrerHost, views: sql<number>`count(*)` })
		.from(events)
		.where(and(inWindow, isNotNull(events.referrerHost)))
		.groupBy(events.referrerHost)
		.orderBy(desc(sql`count(*)`))
		.limit(10)
		.all();

	const locales = db
		.select({ locale: events.locale, views: sql<number>`count(*)` })
		.from(events)
		.where(inWindow)
		.groupBy(events.locale)
		.orderBy(desc(sql`count(*)`))
		.all();

	const recentErrors = db.select().from(errors).orderBy(desc(errors.lastSeen)).limit(20).all();

	return {
		today: byDay.get(today) ?? { day: today, views: 0, visitors: 0 },
		last7: recent(7),
		last30: recent(WINDOW_DAYS),
		// Oldest first, so the chart reads left to right.
		daily: [...daily].reverse(),
		topTeams,
		topLeagues,
		referrers,
		locales,
		recentErrors,
		windowDays: WINDOW_DAYS,
		alertsConfigured: Boolean(env.ALERT_WEBHOOK_URL)
	};
}

export async function load({ cookies }) {
	if (!env.ADMIN_TOKEN) return { state: 'unconfigured' as const };
	if (!isAuthenticated(cookies)) return { state: 'locked' as const };
	return { state: 'open' as const, stats: stats(), sync: syncPanel() };
}

export const actions = {
	login: async ({ cookies, request, url }) => {
		const secret = env.ADMIN_TOKEN;
		if (!secret) return fail(503, { message: 'ADMIN_TOKEN is not set on this deployment.' });

		const form = await request.formData();
		const token = form.get('token');

		if (typeof token !== 'string' || !tokenMatches(token, secret)) {
			await loginDelay();
			return fail(401, { message: 'That token is not right.' });
		}

		startSession(cookies, url);
		// Redirect rather than render, so a refresh doesn't re-post the token.
		redirect(303, '/admin');
	},

	logout: async ({ cookies }) => {
		endSession(cookies);
		redirect(303, '/admin');
	},

	resync: async ({ cookies }) => {
		// Actions are their own endpoints — the load function guarding the page
		// does nothing for a POST. Without this check anyone could kick off a
		// couple of minutes of requests against five leagues' APIs, repeatedly.
		if (!isAuthenticated(cookies)) return fail(401, { message: 'Not signed in.' });

		// Fire-and-forget: a full sync walks every team in every league and takes
		// minutes, which is far longer than a form post should hang. The page polls
		// for progress instead — and that polling is also what keeps Fly from
		// stopping the machine out from under the sync while it runs.
		const { started } = syncRostersOnce();
		return { message: started ? 'Sync started.' : 'A sync was already running.' };
	}
};
