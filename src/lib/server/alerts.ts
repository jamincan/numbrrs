import { env } from '$env/dynamic/private';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { errors } from '$lib/server/db/schema';
import { MAX_MESSAGE, MAX_STACK, fingerprintOf, truncate } from '$lib/server/telemetry';
import { SITE_ORIGIN } from '$lib/site';

export type ErrorSource = 'server' | 'client' | 'sync';

export interface ErrorReport {
	source: ErrorSource;
	message: string;
	stack?: string | null;
	route?: string | null;
}

/**
 * Don't ping the same fingerprint more than once an hour. A route that throws
 * on every request would otherwise send a notification per visitor, and an
 * alert channel that cries wolf is one you learn to ignore.
 */
const NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * Ceiling on notifications per hour across *all* fingerprints. The per-error
 * cooldown above doesn't help when the errors are all slightly different — say
 * a message with an ID in it that normalization missed. This is the backstop.
 */
const NOTIFY_BURST_LIMIT = 5;

/** Timestamps of recent Discord posts, newest last. Resets when the machine stops, which is fine — so does the burst. */
const recentNotifications: number[] = [];

/**
 * Record an error and, if it's worth interrupting someone over, push it to
 * Discord.
 *
 * The database write is synchronous and always happens; the webhook is
 * fire-and-forget. That ordering is deliberate — Fly stops the machine once it
 * goes idle, and a detached fetch can be cut off mid-flight, so the durable
 * record has to be the one that isn't racing the shutdown. A missed ping costs
 * you a delay; a missed row costs you the evidence.
 *
 * Never throws: this runs inside error handlers, and an error reporter that
 * fails loudly turns one broken request into two.
 *
 * Returns the fingerprint, which doubles as the reference a visitor can quote
 * back off the error page. It identifies the *fault* rather than their
 * particular visit — two people hitting the same bug get the same string — but
 * that is the more useful of the two: it points at exactly one row in `errors`,
 * where the count and the timestamps already say how widespread it is. A
 * per-occurrence id would need its own column and would still have to be looked
 * up by hand. Computed before the write, so it comes back even if the database
 * is the thing that's broken.
 */
export function reportError(report: ErrorReport): string {
	const now = Date.now();
	const route = report.route ?? null;
	const message = truncate(report.message, MAX_MESSAGE);
	const fingerprint = fingerprintOf(report.source, report.message, route);

	try {
		const db = getDb();
		const [row] = db
			.insert(errors)
			.values({
				fingerprint,
				source: report.source,
				message,
				stack: report.stack ? truncate(report.stack, MAX_STACK) : null,
				route,
				firstSeen: now,
				lastSeen: now,
				count: 1,
				notifiedAt: null
			})
			.onConflictDoUpdate({
				target: errors.fingerprint,
				set: {
					lastSeen: now,
					count: sql`${errors.count} + 1`,
					// Keep the newest message and stack: the latest occurrence is the
					// one you'd want to reproduce.
					message,
					stack: report.stack ? truncate(report.stack, MAX_STACK) : null
				}
			})
			.returning({ notifiedAt: errors.notifiedAt, count: errors.count })
			.all();

		console.error(`[${report.source}] ${route ?? '-'} (${fingerprint}): ${message}`);

		if (row && claimNotificationSlot(row.notifiedAt, now)) {
			db.update(errors).set({ notifiedAt: now }).where(eq(errors.fingerprint, fingerprint)).run();
			void notify(report, message, route, row.count);
		}
	} catch (err) {
		console.error('Failed to record error report:', err);
	}

	return fingerprint;
}

/**
 * Whether this error has earned a ping, consuming a slot from the burst budget
 * if so. Two gates: the per-fingerprint cooldown, then the ceiling across all
 * fingerprints.
 *
 * Named for the side effect rather than the question — asking reserves the
 * slot, so it must not be called anywhere the answer would be discarded.
 */
function claimNotificationSlot(notifiedAt: number | null, now: number): boolean {
	if (notifiedAt !== null && now - notifiedAt < NOTIFY_COOLDOWN_MS) return false;

	while (recentNotifications.length > 0) {
		// Just checked the array is non-empty, so index 0 exists.
		const oldest = recentNotifications[0]!;
		if (now - oldest <= NOTIFY_COOLDOWN_MS) break;
		recentNotifications.shift();
	}
	if (recentNotifications.length >= NOTIFY_BURST_LIMIT) return false;

	recentNotifications.push(now);
	return true;
}

/**
 * Visually close to a backtick but not one Discord's Markdown parses as a code
 * fence or inline-code delimiter. `source: 'client'` content comes straight off
 * a POST body anyone can send (`api/client-error/+server.ts`), so a backtick in
 * there can close a fence early and turn the rest of the payload into rendered
 * Markdown instead of literal text.
 */
const BACKTICK_LOOKALIKE = 'ˋ';

function neutralizeBackticks(value: string): string {
	return value.replaceAll('`', BACKTICK_LOOKALIKE);
}

function notify(
	report: ErrorReport,
	message: string,
	route: string | null,
	count: number
): Promise<void> {
	const webhook = env.ALERT_WEBHOOK_URL;
	if (!webhook) return Promise.resolve();

	// 'server' and 'sync' never carry attacker-supplied text; 'client' does, so
	// it's worth flagging at a glance rather than making a reader infer trust
	// from the source label alone.
	const sourceLabel = report.source === 'client' ? 'client (unauthenticated)' : report.source;
	const lines = [
		`**numbrrs ${sourceLabel} error**${count > 1 ? ` (${count}× so far)` : ''}`,
		route ? `\`${neutralizeBackticks(route)}\`` : null,
		'```',
		neutralizeBackticks(truncate(report.stack || message, 1200)),
		'```',
		`${SITE_ORIGIN}/admin`
	].filter(Boolean);

	return fetch(webhook, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		// Stops the message from pinging anything, regardless of the escaping
		// above — the documented way to neutralize @everyone/@here/@role/@user.
		body: JSON.stringify({ content: lines.join('\n'), allowed_mentions: { parse: [] } }),
		signal: AbortSignal.timeout(5000)
	})
		.then((res) => {
			if (!res.ok) console.error(`Alert webhook returned ${res.status}`);
		})
		.catch((err) => console.error('Alert webhook failed:', err));
}
