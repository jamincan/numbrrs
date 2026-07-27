import { randomBytes } from 'node:crypto';
import { lt } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { clientIp } from '$lib/server/client-ip';
import { db } from '$lib/server/db';
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
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
let lastPrune = 0;

/**
 * Pruning rides along on a request rather than running on a timer: the machine
 * stops when idle, so a timer would only ever fire on a busy app — the one case
 * where it isn't needed. Cheap enough to do inline (two indexed deletes, a few
 * times a day).
 */
function pruneIfDue(now: number): void {
	if (now - lastPrune < PRUNE_INTERVAL_MS) return;
	lastPrune = now;
	const cutoff = now - RETENTION_MS;
	db.delete(events).where(lt(events.at, cutoff)).run();
	db.delete(errors).where(lt(errors.lastSeen, cutoff)).run();
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
