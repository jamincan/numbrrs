import { randomBytes } from 'node:crypto';
import { desc, inArray, lt, lte, type SQL } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { clientIp } from '$lib/server/client-ip';
import { getDb } from '$lib/server/db';
import { events, errors } from '$lib/server/db/schema';
import { dayKey, isBot, referrerHost, visitorHash } from '$lib/server/telemetry';
import { SITE_ORIGIN } from '$lib/site';

/**
 * The salt behind the visitor hash. Regenerated whenever the day rolls over and
 * never written to disk — see $lib/server/telemetry for why that's the point.
 *
 * A machine restart mid-day rotates it early, which slightly over-counts
 * uniques for that day. The alternative is persisting the salt, which is
 * exactly the thing being avoided.
 */
let salt = { day: '', value: Buffer.alloc(0) };

function saltFor(day: string): Buffer {
	if (salt.day !== day) {
		salt = { day, value: randomBytes(32) };
	}
	return salt.value;
}

/** Keep three months. Long enough to see a trend, short enough that a 256mb machine never notices. */
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * A second bound, on rows rather than time. Ninety days is only a size if you
 * also know the arrival rate, and the rate is exactly what a link from a large
 * subreddit changes: at ~175 bytes a row, a front-page day is six figures of
 * events and over 100mb on a 1gb volume. This is what makes the ceiling a
 * property of the configuration instead of a property of the traffic.
 *
 * Oldest-first, so what a spike costs you is old history rather than the spike
 * itself — which is the half you'd actually want to look at afterwards.
 */
const MAX_EVENTS = 500_000;

/**
 * Deletes are chunked because better-sqlite3 is synchronous: one statement
 * removing a spike's worth of rows blocks the event loop, and the request that
 * happens to trigger it pays the whole bill. A pass that hits its ceiling has
 * more to do and comes back in a minute rather than sitting on the backlog for
 * another six hours.
 */
const PRUNE_BATCH = 2_000;
const PRUNE_MAX_ROWS = 20_000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRUNE_CATCHUP_MS = 60 * 1000;

let lastPrune = 0;
let pruneInterval = PRUNE_INTERVAL_MS;

/** Deletes up to `limit` of the oldest events matching `where`. Returns how many went. */
export function deleteOldestEvents(where: SQL, limit: number): number {
	const db = getDb();
	const doomed = db
		.select({ id: events.id })
		.from(events)
		.where(where)
		.orderBy(events.id)
		.limit(limit)
		.all()
		.map((row) => row.id);

	if (doomed.length === 0) return 0;
	db.delete(events).where(inArray(events.id, doomed)).run();
	return doomed.length;
}

export interface PruneLimits {
	retentionMs?: number;
	maxEvents?: number;
	pruneBatch?: number;
	pruneMaxRows?: number;
}

/**
 * Thresholds default to the production constants above; tests override them to
 * exercise the same two-phase logic — age cutoff, then row-count ceiling —
 * against a few dozen rows instead of the real half-million.
 */
export function pruneEvents(
	now: number,
	{
		retentionMs = RETENTION_MS,
		maxEvents = MAX_EVENTS,
		pruneBatch = PRUNE_BATCH,
		pruneMaxRows = PRUNE_MAX_ROWS
	}: PruneLimits = {}
): number {
	const cutoff = now - retentionMs;
	let removed = 0;

	while (removed < pruneMaxRows) {
		const batch = Math.min(pruneBatch, pruneMaxRows - removed);
		const went = deleteOldestEvents(lt(events.at, cutoff), batch);
		if (went === 0) break;
		removed += went;
	}

	// `id` is autoincrementing, so the newest `maxEvents` rows are the highest
	// ids. Anything at or below the row one past that boundary is surplus.
	while (removed < pruneMaxRows) {
		const [boundary] = getDb()
			.select({ id: events.id })
			.from(events)
			.orderBy(desc(events.id))
			.limit(1)
			.offset(maxEvents)
			.all();
		if (!boundary) break;

		const batch = Math.min(pruneBatch, pruneMaxRows - removed);
		const went = deleteOldestEvents(lte(events.id, boundary.id), batch);
		if (went === 0) break;
		removed += went;
	}

	return removed;
}

/**
 * Pruning rides along on a request rather than running on a timer: the machine
 * stops when idle, so a timer would only ever fire on a busy app — the one case
 * where it isn't needed.
 */
function pruneIfDue(now: number): void {
	if (now - lastPrune < pruneInterval) return;
	lastPrune = now;

	const removed = pruneEvents(now);
	pruneInterval = removed >= PRUNE_MAX_ROWS ? PRUNE_CATCHUP_MS : PRUNE_INTERVAL_MS;

	// Errors need no ceiling and no batching: they fold by fingerprint, so the
	// table is bounded by the number of distinct bugs rather than by how often
	// they fire.
	getDb()
		.delete(errors)
		.where(lt(errors.lastSeen, now - RETENTION_MS))
		.run();
}

export interface EventInput {
	name: string;
	props?: Record<string, unknown>;
}

/**
 * Record one event for this request. Written synchronously — a single insert
 * into a local SQLite file is well under a millisecond, and buffering in memory
 * would lose whatever hadn't flushed when Fly stops the machine for idleness.
 *
 * Never throws. Analytics failing is not a reason for a visitor's page to fail.
 */
export function recordEvent(event: RequestEvent, input: EventInput): void {
	try {
		const userAgent = event.request.headers.get('user-agent') ?? '';
		if (isBot(userAgent)) return;

		const now = Date.now();
		const day = dayKey(now);

		const db = getDb();
		db.insert(events)
			.values({
				at: now,
				day,
				name: input.name,
				path: event.url.pathname.slice(0, 200),
				routeId: event.route.id ?? null,
				// Team URLs are case-insensitive — the page load normalizes them, but
				// that happens after this hook, so /game/nhl/tor and /game/nhl/TOR
				// would otherwise count as two different teams.
				league: event.params.league?.toLowerCase() ?? null,
				team: event.params.team?.toUpperCase() ?? null,
				locale: event.locals.locale,
				referrerHost: referrerHost(event.request.headers.get('referer'), [
					event.url.hostname,
					new URL(SITE_ORIGIN).hostname
				]),
				visitorHash: visitorHash(saltFor(day), day, clientIp(event), userAgent),
				props: input.props ? JSON.stringify(input.props) : null
			})
			.run();

		pruneIfDue(now);
	} catch (err) {
		console.error('Failed to record event:', err);
	}
}
