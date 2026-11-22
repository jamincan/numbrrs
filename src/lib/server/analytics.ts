import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, lt, lte, max, notInArray } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import type { Locale } from '#lib/i18n/index.ts';
import { clientIp } from '#lib/server/client-ip.ts';
import { getDb } from '#lib/server/db/index.ts';
import { events, errors } from '#lib/server/db/schema.ts';
import { dayKey, isBot, referrerHost, visitorHash } from '#lib/server/telemetry.ts';
import { OWN_HOSTNAMES } from '#lib/site.ts';

/**
 * The salt behind the visitor hash. Regenerated whenever the day rolls over and
 * never written to disk — see #lib/server/telemetry for why that's the point.
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

/**
 * Error rows fold by fingerprint, so server and sync errors are bounded by the
 * number of distinct bugs. Browser reports are not: the message comes off a
 * POST body anyone can send, and every new string is a new fingerprint. The
 * endpoint's rate limit slows that down without bounding it, so the newest few
 * hundred are kept and the rest go — far more than a real client-side bug
 * produces, and small enough that the table can't be used to fill the volume.
 */
const MAX_CLIENT_ERRORS = 500;

let lastPrune = 0;
let pruneInterval = PRUNE_INTERVAL_MS;

/** Which events a prune batch takes: those older than a time, or up to an id. */
export type EventRange = { before: number } | { throughId: number };

/**
 * Deletes up to `limit` of the oldest events in a range. Returns how many went.
 *
 * Each range is paired with the ordering of the index that serves it —
 * `events_at_idx` for a time, the primary key for an id — so finding a batch
 * reads `limit` index entries from the low end and stops. Filtering on one
 * column while ordering by another makes SQLite walk the table instead, once
 * per batch, and this runs inside somebody's request.
 */
export function deleteOldestEvents(range: EventRange, limit: number): number {
	const db = getDb();
	const ids = db.select({ id: events.id }).from(events);
	const doomed = (
		'before' in range
			? ids.where(lt(events.at, range.before)).orderBy(events.at, events.id)
			: ids.where(lte(events.id, range.throughId)).orderBy(events.id)
	)
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
	maxClientErrors?: number;
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
		const went = deleteOldestEvents({ before: cutoff }, batch);
		if (went === 0) break;
		removed += went;
	}

	// `id` is autoincrementing and rows only ever leave from the old end, so the
	// newest `maxEvents` rows are the top `maxEvents` ids, and everything at or
	// below `newest - maxEvents` is surplus. Read off the end of the primary key
	// instead of counting back through that many rows to find the boundary.
	const newest =
		getDb()
			.select({ id: max(events.id) })
			.from(events)
			.get()?.id ?? 0;
	const boundary = newest - maxEvents;

	while (boundary > 0 && removed < pruneMaxRows) {
		const batch = Math.min(pruneBatch, pruneMaxRows - removed);
		const went = deleteOldestEvents({ throughId: boundary }, batch);
		if (went === 0) break;
		removed += went;
	}

	return removed;
}

/**
 * Trims the errors table: anything not seen within the retention window, then
 * browser reports beyond the newest `maxClientErrors`.
 *
 * Neither is batched. Age is bounded by how many distinct errors there are, and
 * the cap runs every pass, so what it removes is only what arrived since the
 * last one.
 */
export function pruneErrors(
	now: number,
	{ retentionMs = RETENTION_MS, maxClientErrors = MAX_CLIENT_ERRORS }: PruneLimits = {}
): void {
	const db = getDb();
	db.delete(errors)
		.where(lt(errors.lastSeen, now - retentionMs))
		.run();

	const fromClient = eq(errors.source, 'client');
	const newest = db
		.select({ fingerprint: errors.fingerprint })
		.from(errors)
		.where(fromClient)
		.orderBy(desc(errors.lastSeen))
		.limit(maxClientErrors);
	db.delete(errors)
		.where(and(fromClient, notInArray(errors.fingerprint, newest)))
		.run();
}

/**
 * Pruning rides along on a request rather than running on a timer: rows only
 * arrive with requests, so an app nobody is visiting has nothing new to prune.
 *
 * A pass that hit its ceiling left a backlog, and the next one is due in a
 * minute rather than in six hours.
 */
export function pruneIfDue(now: number, limits: PruneLimits = {}): void {
	if (now - lastPrune < pruneInterval) return;
	lastPrune = now;

	const removed = pruneEvents(now, limits);
	pruneInterval =
		removed >= (limits.pruneMaxRows ?? PRUNE_MAX_ROWS) ? PRUNE_CATCHUP_MS : PRUNE_INTERVAL_MS;

	pruneErrors(now, limits);
}

export interface EventInput {
	name: string;
	props?: Record<string, unknown>;
}

/** The page an event is about: what the router made of the URL it was asked for. */
export interface EventPage {
	pathname: string;
	routeId: string | null;
	params: Partial<Record<string, string>>;
	locale: Locale;
}

/**
 * Who an event came from. This is everything a row's visitor hash and referrer
 * host are derived from, and none of it is written down as given: the address
 * and user agent go into the hash and nowhere else, and the referrer is cut to
 * its hostname.
 */
export interface EventVisitor {
	/** As `clientIp` returns it — see `visitorKey` for the form. */
	ip: string;
	userAgent: string;
	referer: string | null;
	/** The host the request was for, which is never a referral. */
	hostname: string;
}

/**
 * Who answered the visitor: this server, or the Cloudflare Worker from its
 * cache. See cloudflare/locale-cache-worker.ts.
 */
export type ServedBy = 'origin' | 'edge';

/**
 * The one place an event becomes a row, whoever is reporting it, so a view the
 * edge answered is filtered and stored exactly as one the origin rendered,
 * apart from saying which of the two it was. Returns whether a row was
 * written; a bot's visit is not.
 */
function insertEvent(
	input: EventInput,
	page: EventPage,
	visitor: EventVisitor,
	servedBy: ServedBy,
	now: number
) {
	if (isBot(visitor.userAgent)) return false;

	const day = dayKey(now);

	getDb()
		.insert(events)
		.values({
			at: now,
			day,
			name: input.name,
			path: page.pathname.slice(0, 200),
			routeId: page.routeId,
			// Team URLs are case-insensitive — the page load normalizes them, but
			// that happens after the hook that records the view, so /game/nhl/tor
			// and /game/nhl/TOR would otherwise count as two different teams.
			league: page.params.league?.toLowerCase() ?? null,
			team: page.params.team?.toUpperCase() ?? null,
			locale: page.locale,
			referrerHost: referrerHost(visitor.referer, [visitor.hostname, ...OWN_HOSTNAMES]),
			visitorHash: visitorHash(saltFor(day), day, visitor.ip, visitor.userAgent),
			servedBy,
			props: input.props ? JSON.stringify(input.props) : null
		})
		.run();

	return true;
}

/**
 * Record one event for this request. Written synchronously — a single insert
 * into a local SQLite file is well under a millisecond, and buffering in memory
 * would lose whatever hadn't flushed when a deploy or a crash ends the process.
 *
 * Never throws. Analytics failing is not a reason for a visitor's page to fail.
 */
export function recordEvent(event: RequestEvent, input: EventInput): void {
	try {
		const now = Date.now();
		const written = insertEvent(
			input,
			{
				pathname: event.url.pathname,
				routeId: event.route.id ?? null,
				params: event.params,
				locale: event.locals.locale
			},
			{
				ip: clientIp(event),
				userAgent: event.request.headers.get('user-agent') ?? '',
				referer: event.request.headers.get('referer'),
				hostname: event.url.hostname
			},
			'origin',
			now
		);

		if (written) pruneIfDue(now);
	} catch (err) {
		console.error('Failed to record event:', err);
	}
}

/**
 * Record page views the edge served from its cache, which never reached this
 * server as requests of their own (see src/routes/api/hit/+server.ts, the only
 * caller). Each becomes the row `recordEvent` would have written had the page
 * been rendered here: same filter, same columns, and marked as the edge's so
 * the dashboard can say how much of the traffic the cache is carrying.
 *
 * The rows carry the time the report arrived rather than the time of the view.
 * The Worker holds a report for a few seconds at most, and taking a time from
 * it would mean choosing a salt for a day that may already have ended.
 *
 * One transaction for the lot, so a batch costs one commit rather than one per
 * view. Returns how many rows were written. Never throws.
 */
export function recordEdgeViews(views: { page: EventPage; visitor: EventVisitor }[]): number {
	if (views.length === 0) return 0;
	try {
		const now = Date.now();
		// The inserts run on the connection the transaction is open on, so they
		// are part of it without being handed its handle.
		const written = getDb().transaction(() => {
			let count = 0;
			for (const { page, visitor } of views) {
				if (insertEvent({ name: 'pageview' }, page, visitor, 'edge', now)) count += 1;
			}
			return count;
		});

		if (written > 0) pruneIfDue(now);
		return written;
	} catch (err) {
		console.error('Failed to record edge views:', err);
		return 0;
	}
}
