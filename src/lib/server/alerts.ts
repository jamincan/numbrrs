import { env } from '$env/dynamic/private';
import { eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
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
 */
export function reportError(report: ErrorReport): void {
	try {
		const now = Date.now();
		const route = report.route ?? null;
		const message = truncate(report.message, MAX_MESSAGE);
		const fingerprint = fingerprintOf(report.source, report.message, route);

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

		console.error(`[${report.source}] ${route ?? '-'}: ${message}`);

		if (!row) return;
		if (row.notifiedAt !== null && now - row.notifiedAt < NOTIFY_COOLDOWN_MS) return;

		while (recentNotifications.length && now - recentNotifications[0] > NOTIFY_COOLDOWN_MS) {
			recentNotifications.shift();
		}
		if (recentNotifications.length >= NOTIFY_BURST_LIMIT) return;
		recentNotifications.push(now);

		db.update(errors).set({ notifiedAt: now }).where(eq(errors.fingerprint, fingerprint)).run();
		void notify(report, message, route, row.count);
	} catch (err) {
		console.error('Failed to record error report:', err);
	}
}

function notify(
	report: ErrorReport,
	message: string,
	route: string | null,
	count: number
): Promise<void> {
	const webhook = env.ALERT_WEBHOOK_URL;
	if (!webhook) return Promise.resolve();

	const lines = [
		`**numbrrs ${report.source} error**${count > 1 ? ` (${count}× so far)` : ''}`,
		route ? `\`${route}\`` : null,
		'```',
		truncate(report.stack || message, 1200),
		'```',
		`${SITE_ORIGIN}/admin`
	].filter(Boolean);

	return fetch(webhook, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ content: lines.join('\n') }),
		signal: AbortSignal.timeout(5000)
	})
		.then((res) => {
			if (!res.ok) console.error(`Alert webhook returned ${res.status}`);
		})
		.catch((err) => console.error('Alert webhook failed:', err));
}
