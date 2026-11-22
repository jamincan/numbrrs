import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq, gte, isNotNull, sql, type SQL } from 'drizzle-orm';
import { ALERT_WEBHOOK_URL, ADMIN_DIRECT, ADMIN_TOKEN } from '$app/env/private';
import type { ServedBy } from '#lib/server/analytics.ts';
import { dayKey } from '#lib/server/telemetry.ts';
import {
	endSession,
	isAuthenticated,
	loginDelay,
	startSession,
	tokenMatches
} from '#lib/server/admin.ts';
import { clientIp } from '#lib/server/client-ip.ts';
import { createRateLimiter } from '#lib/server/rate-limit.ts';
import { getDb } from '#lib/server/db/index.ts';
import { errors, events, syncState, teams } from '#lib/server/db/schema.ts';
import {
	fullSyncStatus,
	isRosterStale,
	syncRostersOnce,
	teamListKey
} from '#lib/server/leagues/index.ts';
import { LEAGUES } from '#lib/leagues.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 30;

/**
 * How long the usage figures are reused before being computed again. They are
 * several GROUP BY passes over a month of events, run synchronously: at the
 * table's row cap that is seconds during which nothing else is served, and the
 * page asks again every few seconds while a sync runs. Nothing on a 30-day
 * chart is worth that to have a minute sooner.
 */
const USAGE_TTL_MS = 60 * 1000;

/**
 * Roster freshness per league, plus how far a running sync has got. Progress is
 * measured against the current run's start time rather than a counter the sync
 * keeps: the sync is fire-and-forget and the machine can restart under it, and
 * a timestamp already in the database survives that where a counter wouldn't.
 */
function syncPanel() {
	const db = getDb();
	const status = fullSyncStatus();

	const listSyncedAt = new Map(
		db
			.select()
			.from(syncState)
			.all()
			.map((s) => [s.key, s.syncedAt])
	);

	const leagues = LEAGUES.map((league) => {
		const rows = db
			.select({ id: teams.id, rosterSyncedAt: teams.rosterSyncedAt })
			.from(teams)
			.where(eq(teams.league, league.id))
			.all();

		const synced = rows.filter((r) => r.rosterSyncedAt != null).map((r) => r.rosterSyncedAt!);
		return {
			id: league.id,
			label: league.label.en,
			teams: rows.length,
			// The sync layer's own answer, so this counts exactly the teams the next
			// sweep will refresh — never-synced and emptied ones included.
			stale: rows.filter(isRosterStale).length,
			// Only meaningful once every team has been synced at least once —
			// otherwise "oldest" would quietly ignore the ones that have no
			// timestamp at all. The stale count covers those.
			oldestRoster: synced.length === rows.length && synced.length > 0 ? Math.min(...synced) : null,
			// A list that has only ever failed is recorded with a timestamp of 0,
			// which is "never", not a date in 1970.
			teamListSyncedAt: listSyncedAt.get(teamListKey(league.id)) || null,
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
function computeUsage(now: number) {
	const db = getDb();
	const today = dayKey(now);
	const since = dayKey(now - WINDOW_DAYS * DAY_MS);
	const pageviews = eq(events.name, 'pageview');
	const inWindow = and(pageviews, gte(events.day, since));

	// Who served each view is counted in the same pass as the totals, since a
	// second walk over a month of events is the cost this function is cached to
	// avoid. A row from before that was recorded has no `servedBy` and falls
	// out of every figure but the first two.
	const servedBy = (who: ServedBy) => sql`${events.servedBy} = ${who}`;
	const visitorsWhere = (condition: SQL) =>
		sql<number>`count(distinct case when ${condition} then ${events.visitorHash} end)`;
	const rollup = db
		.select({
			day: events.day,
			views: sql<number>`count(*)`,
			visitors: sql<number>`count(distinct ${events.visitorHash})`,
			edgeViews: sql<number>`coalesce(sum(${servedBy('edge')}), 0)`,
			originViews: sql<number>`coalesce(sum(${servedBy('origin')}), 0)`,
			edgeVisitors: visitorsWhere(servedBy('edge')),
			originVisitors: visitorsWhere(servedBy('origin')),
			servedVisitors: visitorsWhere(sql`${events.servedBy} is not null`)
		})
		.from(events)
		.where(inWindow)
		.groupBy(events.day)
		.orderBy(desc(events.day))
		.all();

	const daily = rollup.map(({ day, views, visitors }) => ({ day, views, visitors }));

	/**
	 * How the views and visitors of the last `days` days divide between the edge
	 * cache and this server. A visitor can be served by both in one day (a page
	 * from the cache, the next one rendered here), so visitors divide three
	 * ways, worked out from the three distinct counts each day has: everyone
	 * the server saw is in `originVisitors`, so whoever is left was served by
	 * the cache alone, and the same the other way round.
	 */
	const served = (label: string, days: number) => {
		const cutoff = dayKey(now - days * DAY_MS);
		const split = { label, edgeViews: 0, originViews: 0, edgeOnly: 0, both: 0, originOnly: 0 };
		for (const d of rollup) {
			if (d.day <= cutoff) continue;
			split.edgeViews += d.edgeViews;
			split.originViews += d.originViews;
			split.edgeOnly += d.servedVisitors - d.originVisitors;
			split.originOnly += d.servedVisitors - d.edgeVisitors;
			split.both += d.edgeVisitors + d.originVisitors - d.servedVisitors;
		}
		return split;
	};

	// The first day in the window with a view that says who served it, when the
	// window also holds views that don't: the figures start there and not at the
	// window's edge, and the page says so.
	const servedDays = rollup.filter((d) => d.edgeViews + d.originViews > 0);
	const servedSince = rollup.some((d) => d.views > d.edgeViews + d.originViews)
		? (servedDays.at(-1)?.day ?? null)
		: null;

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

	return {
		today: byDay.get(today) ?? { day: today, views: 0, visitors: 0 },
		last7: recent(7),
		last30: recent(WINDOW_DAYS),
		// Oldest first, so the chart reads left to right.
		daily: [...daily].reverse(),
		served: {
			periods: [
				served('Today', 1),
				served('7 days', 7),
				served(`${WINDOW_DAYS} days`, WINDOW_DAYS)
			],
			recorded: servedDays.length > 0,
			since: servedSince
		},
		topTeams,
		topLeagues,
		referrers,
		locales,
		windowDays: WINDOW_DAYS
	};
}

/**
 * The last usage figures computed, and the database they came from: a result
 * is only reused against the same database it was read out of.
 */
let usageCache:
	{ db: ReturnType<typeof getDb>; at: number; value: ReturnType<typeof computeUsage> } | undefined;

function usage(now: number) {
	const db = getDb();
	if (!usageCache || usageCache.db !== db || now - usageCache.at >= USAGE_TTL_MS) {
		usageCache = { db, at: now, value: computeUsage(now) };
	}
	return usageCache.value;
}

/**
 * Everything above the roster panel. The usage figures may be up to a minute
 * old; the error list is one indexed read of twenty rows and is always current,
 * since it is the part of this page someone is most likely refreshing to watch.
 */
function stats() {
	const now = Date.now();
	return {
		...usage(now),
		recentErrors: getDb().select().from(errors).orderBy(desc(errors.lastSeen)).limit(20).all(),
		alertsConfigured: Boolean(ALERT_WEBHOOK_URL)
	};
}

export async function load({ cookies }) {
	// On every state, the login screen included, so a switch left on can't go
	// unnoticed.
	const directAccess = ADMIN_DIRECT;
	if (!ADMIN_TOKEN) return { state: 'unconfigured' as const, directAccess };
	if (!isAuthenticated(cookies)) return { state: 'locked' as const, directAccess };
	return { state: 'open' as const, directAccess, stats: stats(), sync: syncPanel() };
}

/**
 * Deliberately per-IP only. A ceiling shared across addresses would let anyone
 * who found this form spend the budget and lock the real admin out — trading a
 * brute-force defence for a denial of service, against a token that is 32 random
 * bytes and was never going to be guessed anyway. The point of limiting here is
 * to make a scripted attempt cheap to absorb and visible in the logs.
 */
const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

export const actions = {
	login: async (event) => {
		const { cookies, request, url } = event;
		const secret = ADMIN_TOKEN;
		if (!secret) return fail(503, { message: 'ADMIN_TOKEN is not set on this deployment.' });

		const ip = clientIp(event);
		if (!loginLimiter.allow(ip, Date.now())) {
			console.warn(`[admin] login rate-limited for ${ip}`);
			return fail(429, { message: 'Too many attempts. Wait a few minutes and try again.' });
		}

		const form = await request.formData();
		const token = form.get('token');

		if (typeof token !== 'string' || !tokenMatches(token, secret)) {
			// Logged rather than reported: a wrong password is somebody's problem,
			// not the app's, and routing it through reportError would page Discord
			// for a typo and bury real faults under a sustained attempt.
			console.warn(`[admin] failed login from ${ip}`);
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
		// for progress instead. Nothing waits on the returned promise, which is
		// why syncRostersOnce guarantees it never rejects.
		const { started } = syncRostersOnce();
		return { message: started ? 'Sync started.' : 'A sync was already running.' };
	}
};
