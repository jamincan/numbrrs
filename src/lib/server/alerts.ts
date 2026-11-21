import { ALERT_WEBHOOK_URL } from '$app/env/private';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db/index.ts';
import { errors } from '#lib/server/db/schema.ts';
import {
	MAX_MESSAGE,
	MAX_ROUTE,
	MAX_STACK,
	fingerprintOf,
	singleLine,
	truncate
} from '#lib/server/telemetry.ts';
import { SITE_ORIGIN } from '#lib/site.ts';

type ErrorSource = 'server' | 'client' | 'sync';

export interface ErrorReport {
	source: ErrorSource;
	message: string;
	stack?: string | null;
	route?: string | null;
	/**
	 * The thrown value itself, when the caller still has it. Only its `cause`
	 * chain is read — `message` and `stack` stay the caller's to choose — so that
	 * "fetch failed" is stored and logged along with the reason it failed.
	 */
	error?: unknown;
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * How long a fingerprint stays quiet after each ping, by how many it has had in
 * its current run. A route that throws on every request would otherwise send a
 * notification per visitor; a fault that is still firing hours later has been
 * announced, and repeating it hourly teaches you to ignore the channel. It
 * settles at one reminder a day.
 */
const COOLDOWN_STEPS_MS = [HOUR_MS, 6 * HOUR_MS, 24 * HOUR_MS];

/** A fingerprint not seen for this long starts over at the first step. */
const QUIET_RESET_MS = 24 * HOUR_MS;

/**
 * Pings per hour, per source. The cooldown doesn't help when the errors are all
 * slightly different — a message with an id in it that normalization missed, an
 * upstream outage failing every league at once.
 *
 * Separate budgets because the sources are not equally trustworthy or equally
 * urgent: `client` reports are anonymous POSTs and `sync` failures arrive in
 * batches, and neither should be able to spend the pings a server error needs.
 */
const HOURLY_BUDGET: Record<ErrorSource, number> = { server: 3, sync: 2, client: 1 };

/**
 * Everything below is per-process and resets on a restart — a deploy, or a
 * crash. The budgets start over, which costs at most one more hour's worth of
 * pings, and the escalation loses only its memory: after a restart
 * `errors.notified_at` still enforces the first step.
 */
const budgetSpent: Record<ErrorSource, number[]> = { server: [], sync: [], client: [] };

interface PingHistory {
	/** Pings in the current run of occurrences. */
	pings: number;
	/** When the last one was claimed; 0 once it has been handed back. */
	notifiedAt: number;
	lastSeen: number;
}

/**
 * Only fingerprints that have been pinged get an entry, so the budgets bound
 * its size as well.
 */
const pingHistory = new Map<string, PingHistory>();

/** Fingerprints that were due a ping when their source's budget was spent. */
const suppressed = new Map<string, ErrorSource>();
const MAX_SUPPRESSED_TRACKED = 200;
let suppressionNoticeAt = 0;

export interface WebhookHealth {
	/** Whether a webhook URL is set at all. */
	configured: boolean;
	/** The most recent POST since this process started, or null if there has been none. */
	last: { at: number; ok: boolean; detail: string } | null;
}

let lastWebhookResult: WebhookHealth['last'] = null;

/**
 * Whether alerts are actually arriving. A revoked or rate-limited webhook
 * otherwise fails in a place nobody is looking: the only symptom is a quiet
 * channel, which is also what a healthy app looks like.
 */
export function webhookHealth(): WebhookHealth {
	return { configured: Boolean(ALERT_WEBHOOK_URL), last: lastWebhookResult };
}

/**
 * Record an error and, if it's worth interrupting someone over, push it to
 * Discord.
 *
 * The database write is synchronous and always happens; the webhook is
 * fire-and-forget. That ordering is deliberate — a deploy or a crash can end
 * the process at any moment, and a detached fetch can be cut off mid-flight, so
 * the durable record has to be the one that isn't racing the shutdown. A missed
 * ping costs you a delay; a missed row costs you the evidence.
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
	const route = report.route ? singleLine(report.route).slice(0, MAX_ROUTE) : null;
	const causes = causeChain(report.error);
	const message = truncate(
		[report.message, ...causes.map((cause) => `caused by: ${describeCause(cause)}`)].join(' — '),
		MAX_MESSAGE
	);
	const alert: Alert = {
		source: report.source,
		// From the caller's message alone. The cause is detail about one occurrence,
		// and in the fingerprint it would split a fault by how it happened to fail.
		fingerprint: fingerprintOf(report.source, report.message, route),
		message,
		stack: report.stack || null,
		route
	};
	const { fingerprint } = alert;

	// Ahead of the write rather than after it, so the error is on stdout even when
	// the database is what's broken.
	logReport(alert, causes);

	let row: { notifiedAt: number | null; count: number } | undefined;
	let unrecorded: string | null = null;
	try {
		const stack = alert.stack ? truncate(alert.stack, MAX_STACK) : null;
		[row] = getDb()
			.insert(errors)
			.values({
				fingerprint,
				source: report.source,
				message,
				stack,
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
					stack
				}
			})
			.returning({ notifiedAt: errors.notifiedAt, count: errors.count })
			.all();
	} catch (err) {
		unrecorded = describeCause(err);
		console.error('Failed to record error report:', err);
	}

	// With no webhook there is nobody to ration pings for, and stamping
	// `notified_at` would claim a notification that never happened.
	if (!ALERT_WEBHOOK_URL) return fingerprint;

	// A failed write still gets its ping — a full disk or a corrupt file is the
	// fault most worth hearing about — from the in-memory half of the cooldown,
	// since there is no row to read the other half from.
	if (claimPing(alert, row?.notifiedAt ?? null, now)) {
		if (unrecorded === null) persistNotifiedAt(fingerprint, now);
		void post(formatAlert(alert, row?.count ?? 1, unrecorded)).then((delivered) => {
			if (!delivered) releasePing(fingerprint, now, unrecorded === null);
		});
	}
	announceSuppressed(now);

	return fingerprint;
}

/** What gets logged and posted: the report after trimming, with its fingerprint. */
interface Alert {
	source: ErrorSource;
	fingerprint: string;
	message: string;
	/** Untrimmed. Each destination applies its own limit. */
	stack: string | null;
	route: string | null;
}

/** Deep enough for any real chain, and a bound on one that loops back on itself. */
const MAX_CAUSES = 5;

function causeChain(error: unknown): unknown[] {
	const chain: unknown[] = [];
	let current = error instanceof Error ? error.cause : undefined;
	while (current !== undefined && current !== null && chain.length < MAX_CAUSES) {
		chain.push(current);
		current = current instanceof Error ? current.cause : undefined;
	}
	return chain;
}

function describeCause(cause: unknown): string {
	if (cause instanceof Error) {
		// Node's network errors often carry an empty message and say what happened
		// in `code` instead (ECONNREFUSED, UND_ERR_CONNECT_TIMEOUT).
		const code = 'code' in cause && typeof cause.code === 'string' ? cause.code : null;
		return cause.message || code || cause.name;
	}
	try {
		return String(cause);
	} catch {
		return 'unprintable value';
	}
}

/** Far more than a real trace needs; a bound on what one report can write to stdout. */
const MAX_LOGGED_DETAIL = 8000;

/**
 * The whole stack and every cause go to stdout, where the row keeps only the
 * first `MAX_STACK` characters: the log is where a trace is read while Fly
 * still has it, and it costs nothing to keep there.
 *
 * Everything under the first line is indented and flattened line by line. A
 * `client` stack is whatever an anonymous POST said it was, and at the left
 * margin a line of it could pass for a log entry of the server's own.
 */
function logReport(alert: Alert, causes: unknown[]): void {
	const head = `[${alert.source}] ${alert.route ?? '-'} (${alert.fingerprint}): ${singleLine(alert.message)}`;
	const detail = [
		alert.stack,
		...causes.map(
			(cause) =>
				`Caused by: ${cause instanceof Error && cause.stack ? cause.stack : describeCause(cause)}`
		)
	]
		.filter(Boolean)
		.join('\n');
	if (!detail) {
		console.error(head);
		return;
	}

	const indented = truncate(detail, MAX_LOGGED_DETAIL)
		.split(/\r\n|[\r\n\p{Zl}\p{Zp}]/u)
		.map((line) => `    ${singleLine(line)}`)
		.join('\n');
	console.error(`${head}\n${indented}`);
}

/**
 * Whether this error has earned a ping, reserving it if so. Two gates: the
 * fingerprint's own cooldown, then its source's hourly budget.
 *
 * Named for the side effect rather than the question — asking reserves the
 * ping, so it must not be called anywhere the answer would be discarded.
 *
 * `persistedNotifiedAt` is the row's `notified_at`: all that is known about a
 * fingerprint after a restart, and absent altogether when the write failed.
 */
function claimPing(alert: Alert, persistedNotifiedAt: number | null, now: number): boolean {
	const { fingerprint, source } = alert;

	let history = pingHistory.get(fingerprint);
	if (history && now - history.lastSeen > QUIET_RESET_MS) {
		pingHistory.delete(fingerprint);
		history = undefined;
	}
	if (history) history.lastSeen = now;

	const lastPing = Math.max(history?.notifiedAt ?? 0, persistedNotifiedAt ?? 0);
	const step = Math.min(Math.max(history?.pings ?? 1, 1), COOLDOWN_STEPS_MS.length) - 1;
	// `step` is clamped to the array's bounds on the line above.
	if (lastPing > 0 && now - lastPing < COOLDOWN_STEPS_MS[step]!) return false;

	const recent = budgetSpent[source].filter((at) => now - at < HOUR_MS);
	budgetSpent[source] = recent;
	if (recent.length >= HOURLY_BUDGET[source]) {
		if (suppressed.size < MAX_SUPPRESSED_TRACKED) suppressed.set(fingerprint, source);
		return false;
	}

	recent.push(now);
	suppressed.delete(fingerprint);
	for (const [key, entry] of pingHistory) {
		if (now - entry.lastSeen > QUIET_RESET_MS) pingHistory.delete(key);
	}
	pingHistory.set(fingerprint, {
		pings: (history?.pings ?? 0) + 1,
		notifiedAt: now,
		lastSeen: now
	});
	return true;
}

/**
 * Hand a ping back after the webhook refused it, so the next occurrence tries
 * again instead of sitting out a cooldown for a message nobody received.
 *
 * The budget slot is deliberately not refunded: against a webhook that is down
 * it is the only thing limiting how often the POST is retried.
 */
function releasePing(fingerprint: string, claimedAt: number, recorded: boolean): void {
	const history = pingHistory.get(fingerprint);
	// Only if the claim is still this one — a later ping may have replaced it.
	if (history?.notifiedAt === claimedAt) {
		if (history.pings <= 1) {
			pingHistory.delete(fingerprint);
		} else {
			history.pings -= 1;
			history.notifiedAt = 0;
		}
	}
	if (recorded) persistNotifiedAt(fingerprint, null, claimedAt);
}

/**
 * Mirror a claim (or its release, when `onlyIf` names the claim being undone)
 * into the row. Best effort: memory already holds the same fact, and this runs
 * on paths where throwing would turn a missed ping into a failed request.
 */
function persistNotifiedAt(fingerprint: string, value: number | null, onlyIf?: number): void {
	try {
		getDb()
			.update(errors)
			.set({ notifiedAt: value })
			.where(
				onlyIf === undefined
					? eq(errors.fingerprint, fingerprint)
					: and(eq(errors.fingerprint, fingerprint), eq(errors.notifiedAt, onlyIf))
			)
			.run();
	} catch (err) {
		console.error('Failed to update notified_at:', err);
	}
}

/**
 * Say that alerts are being held back, at most once an hour. Without it a
 * spent budget is indistinguishable from a quiet hour.
 *
 * Runs on the back of whichever report comes next rather than on a timer, so
 * the first notice goes out with the first suppressed alert and later ones
 * carry everything since. A count that nothing follows waits; it is on the
 * dashboard either way.
 */
function announceSuppressed(now: number): void {
	if (suppressed.size === 0 || now - suppressionNoticeAt < HOUR_MS) return;

	const bySource = new Map<ErrorSource, number>();
	for (const source of suppressed.values()) bySource.set(source, (bySource.get(source) ?? 0) + 1);
	const breakdown = [...bySource].map(([source, count]) => `${source} ${count}`).join(', ');
	const total = `${suppressed.size}${suppressed.size >= MAX_SUPPRESSED_TRACKED ? '+' : ''}`;

	suppressed.clear();
	suppressionNoticeAt = now;

	// Not handed back if the POST fails: a notice about missing alerts that
	// retried itself would be the flood it exists to prevent.
	void post(
		[
			`**numbrrs: ${total} ${total === '1' ? 'alert' : 'alerts'} suppressed** (${breakdown})`,
			'Over the hourly budget: recorded, not posted. Any more are counted in the next notice, an hour from now at the earliest.',
			`${SITE_ORIGIN}/admin`
		].join('\n')
	);
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

function formatAlert(alert: Alert, count: number, unrecorded: string | null): string {
	// 'server' and 'sync' never carry attacker-supplied text; 'client' does, so
	// it's worth flagging at a glance rather than making a reader infer trust
	// from the source label alone.
	const sourceLabel = alert.source === 'client' ? 'client (unauthenticated)' : alert.source;
	// A stack normally opens with its own message, but not with the causes
	// appended to ours, and those are often the line that explains the failure.
	const body =
		alert.stack && !alert.stack.includes(alert.message)
			? `${alert.message}\n${alert.stack}`
			: alert.stack || alert.message;

	return [
		`**numbrrs ${sourceLabel} error**${count > 1 ? ` (${count}× so far)` : ''}`,
		unrecorded === null
			? null
			: `**Not recorded** — the database write failed: ${neutralizeBackticks(truncate(singleLine(unrecorded), 200))}`,
		alert.route ? `\`${neutralizeBackticks(alert.route)}\`` : null,
		'```',
		neutralizeBackticks(truncate(body, 1200)),
		'```',
		`${SITE_ORIGIN}/admin`
	]
		.filter((line) => line !== null)
		.join('\n');
}

/**
 * POST to the webhook and report whether Discord took it. Never rejects: every
 * caller is fire-and-forget, and nothing here may call `reportError` — a
 * failure to alert that raised an alert would have no way to stop.
 */
async function post(content: string): Promise<boolean> {
	const webhook = ALERT_WEBHOOK_URL;
	if (!webhook) return false;

	let ok = false;
	let detail: string;
	try {
		const res = await fetch(webhook, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// Stops the message from pinging anything, regardless of the escaping
			// above — the documented way to neutralize @everyone/@here/@role/@user.
			body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
			signal: AbortSignal.timeout(5000)
		});
		ok = res.ok;
		detail = `HTTP ${res.status}`;
	} catch (err) {
		// Some fetch errors quote the URL they failed on, and this URL is a
		// credential: anyone holding it can post to the channel.
		detail = truncate(singleLine(describeCause(err)).replaceAll(webhook, '<webhook>'), 200);
	}

	lastWebhookResult = { at: Date.now(), ok, detail };
	if (!ok) console.error(`Alert webhook failed: ${detail}`);
	return ok;
}
