/**
 * Watches the site from outside it and tells Discord when something breaks and
 * when it mends. Runs on a Cron Trigger every five minutes (wrangler.uptime.toml)
 * and has no routes, so no visitor's request ever passes through it.
 *
 * The app reports its own errors (src/lib/server/alerts.ts), but only while it
 * is running well enough to do so. A machine that is down, restart-looping, out
 * of disk, or whose hourly roster sweep has silently stopped reports nothing,
 * and a quiet channel is also what a healthy site looks like. This is the
 * second opinion.
 *
 * Each run makes four requests:
 *
 * - `/api/health` and `/api/status` on Fly's own hostname, so that they describe
 *   the machine rather than whatever Cloudflare would answer in its place.
 * - The home page and `/privacy` on the public hostname, the way a browser
 *   asks. The first goes through Cloudflare's proxy to the origin on every
 *   request; the second also goes through the cache Worker, which the home
 *   page is not routed to.
 *
 * It alerts on changes, not on states: one message when a check has failed two
 * runs in a row, reminders at a widening interval while it stays that way, and
 * one when it has passed two runs in a row. What it remembers between runs
 * lives in Workers KV.
 *
 * The file is laid out so that the decisions are plain functions — an HTTP
 * outcome to findings, the previous state and this run's findings to notices
 * and the next state — and the fetching, KV and Discord sit in a thin shell
 * around them (`createMonitor`).
 */

const ORIGIN = 'https://numbrrs.fly.dev';
const SITE = 'https://numbrrs.app';

/**
 * Names itself, and contains both "uptime" and "monitor": the app's bot filter
 * (`BOT_PATTERN` in src/lib/server/telemetry.ts) matches either, which keeps
 * 288 home-page requests a day out of the visit counts.
 */
export const USER_AGENT = 'numbrrs-uptime-monitor/1.0 (+https://numbrrs.app)';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

/** Matches the Cron Trigger in wrangler.uptime.toml. */
const RUN_INTERVAL_MS = 5 * MINUTE;

const FETCH_TIMEOUT_MS = 10_000;

/**
 * A failed request is tried once more before it counts, after a pause long
 * enough for a dropped connection to be a different connection.
 */
const RETRY_DELAY_MS = 3000;

/** The most of a body that is read. Both pages are a fraction of this. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Failing runs in a row before a check is announced. Two, five minutes apart,
 * is what rides out a deploy: the machine is replaced in well under a minute,
 * so a deploy can spoil one run and never the next.
 */
const FAILURES_BEFORE_ALERT = 2;

/**
 * Passing runs in a row before a check is called recovered. Without it a check
 * that alternates would announce an outage and a recovery every ten minutes.
 */
const PASSES_BEFORE_RECOVERY = 2;

/**
 * How long after each notice the next reminder waits, by how many reminders
 * there have been. It settles at one a day, like the app's own alerts: a fault
 * that has been announced and is still there hours later has not been missed.
 */
const REMINDER_STEPS_MS = [3 * HOUR, 6 * HOUR, 24 * HOUR];

/** Below this share of the volume free, the disk is a finding. */
const DISK_FREE_MIN_PERCENT = 15;

/**
 * How far past its refresh time the oldest roster may be. The sweep runs
 * hourly and takes a few minutes, so a roster is normally at most an hour or
 * so overdue; three leaves room for a league's API having a bad afternoon.
 */
const ROSTER_GRACE_SECONDS = 3 * 60 * 60;

/** A failed post by the app stops being a finding once it is this old. */
const ALERT_FAILURE_WINDOW_SECONDS = 24 * 60 * 60;

/** This many restarts inside the window is a loop rather than a deploy. */
const RESTART_LOOP_COUNT = 3;
const RESTART_WINDOW_MS = HOUR;

/**
 * How often to speak when there is no memory to consult: see `blindAlert`.
 */
const BLIND_REPEAT_MS = 30 * MINUTE;

/** Discord refuses a message over 2,000 characters. */
const MAX_CONTENT = 1900;

const STATE_KEY = 'state';

/** While this key exists the monitor does nothing. See the README for setting it. */
const SILENCE_KEY = 'silence';

/** The checks `/api/status` is expected to carry. One going missing is a finding. */
const STATUS_CHECKS = ['database', 'write', 'disk', 'rosters', 'alerts'];

/** What a check name may look like before it is repeated in a message. */
const CHECK_NAME = /^[a-z][a-z0-9_-]{0,31}$/;

/** Something that is wrong right now. `id` is what an outage is tracked under. */
export interface Finding {
	id: string;
	detail: string;
}

/**
 * What one request established. `unknown` lists the findings it could not rule
 * in or out, by id or by an id prefix ending in a colon: when the status report
 * cannot be read, nothing is known about the disk, and an open disk outage must
 * be neither repeated nor called recovered on the strength of that.
 */
export interface Verdict {
	findings: Finding[];
	unknown: string[];
}

/** What one request came to, reduced to the parts that are ever looked at. */
export type Outcome =
	| { kind: 'response'; status: number; contentType: string; body: string }
	| { kind: 'error'; reason: string };

/** The same lookalike src/lib/server/alerts.ts uses in place of a backtick. */
const BACKTICK_LOOKALIKE = 'ˋ';

/**
 * Text that came from somewhere else — an error message, a page title — as an
 * inline code span: one line, cut short, and with nothing in it that could
 * close the span. Inside one, Discord renders no Markdown and links nothing.
 */
export function quote(text: string, max = 80): string {
	const flat = text
		.replace(/[\p{Cc}\p{Zl}\p{Zp}\s]+/gu, ' ')
		.trim()
		.replaceAll('`', BACKTICK_LOOKALIKE);
	const cut = flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
	return cut === '' ? '' : `\`${cut}\``;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function formatDuration(ms: number): string {
	const minutes = Math.max(0, Math.round(ms / MINUTE));
	if (minutes < 1) return 'under a minute';
	const days = Math.floor(minutes / (24 * 60));
	const hours = Math.floor((minutes % (24 * 60)) / 60);
	const rest = minutes % 60;
	if (days > 0) return hours > 0 ? `${days} d ${hours} h` : `${days} d`;
	if (hours > 0) return rest > 0 ? `${hours} h ${rest} min` : `${hours} h`;
	return `${rest} min`;
}

function formatBytes(bytes: number): string {
	const mb = bytes / (1024 * 1024);
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

/**
 * Why a request did not come back as a 200, or null if it did. An error page's
 * title is the only part of a body that is ever repeated: it is usually the
 * whole diagnosis ("Worker exceeded resource limits"), and it is short.
 */
function notOk(outcome: Outcome): string | null {
	if (outcome.kind === 'error') return outcome.reason;
	if (outcome.status === 200) return null;
	const title = /<title[^>]*>([^<]{1,200})/i.exec(outcome.body)?.[1];
	return title ? `HTTP ${outcome.status} ${quote(title)}` : `HTTP ${outcome.status}`;
}

export function evaluateHealth(outcome: Outcome): Verdict {
	const failure = notOk(outcome);
	if (failure) return { findings: [{ id: 'origin', detail: failure }], unknown: [] };
	const body = parseJson(outcome.kind === 'response' ? outcome.body : '');
	if (!isRecord(body) || body.status !== 'ok') {
		return {
			findings: [{ id: 'origin', detail: 'answered 200 without the expected body' }],
			unknown: []
		};
	}
	return { findings: [], unknown: [] };
}

/** Everything that is judged from the status report, and so unknown without it. */
const FROM_STATUS = ['check:', 'disk-space', 'rosters-stale', 'alerts', 'restarts'];

/**
 * Read `/api/status` and apply the thresholds. The report is facts; what
 * counts as a problem is decided here (see src/routes/api/status/report.ts).
 *
 * Strict about shape. A field that has gone missing is a finding, not a pass:
 * otherwise renaming one at the origin would switch its check off without
 * anyone being told.
 */
export function evaluateStatus(outcome: Outcome): Verdict & { bootedAt: number | null } {
	const failure = notOk(outcome);
	if (failure) {
		return { findings: [{ id: 'status', detail: failure }], unknown: FROM_STATUS, bootedAt: null };
	}

	const body = parseJson(outcome.kind === 'response' ? outcome.body : '');
	if (!isRecord(body) || !isRecord(body.checks)) {
		return {
			findings: [{ id: 'status', detail: 'answered 200 with a report that could not be read' }],
			unknown: FROM_STATUS,
			bootedAt: null
		};
	}
	const checks = body.checks;
	const findings: Finding[] = [];
	// A threshold is only applied to a check that ran. When one did not, the
	// finding is that it failed, and what it would have measured is not known.
	const unknown: string[] = [];

	const names = new Set([...STATUS_CHECKS, ...Object.keys(checks)]);
	for (const name of names) {
		// A name that is not shaped like one is not repeated; the report's own
		// `ok` below still catches whatever it was.
		if (!CHECK_NAME.test(name)) continue;
		const result = checks[name];
		if (result === undefined) {
			findings.push({ id: `check:${name}`, detail: 'missing from the status report' });
		} else if (!isRecord(result) || result.ok !== true) {
			findings.push({ id: `check:${name}`, detail: 'the origin reports this check failing' });
		}
	}

	const disk = checks.disk;
	if (!isRecord(disk) || disk.ok !== true) {
		unknown.push('disk-space');
	} else {
		if (!isNumber(disk.freePercent)) {
			findings.push({ id: 'disk-space', detail: 'free space was not reported' });
		} else if (disk.freePercent < DISK_FREE_MIN_PERCENT) {
			const free = isNumber(disk.freeBytes) ? ` (${formatBytes(disk.freeBytes)})` : '';
			findings.push({
				id: 'disk-space',
				detail: `${disk.freePercent}% of the volume is free${free}; the threshold is ${DISK_FREE_MIN_PERCENT}%`
			});
		}
	}

	const rosters = checks.rosters;
	if (!isRecord(rosters) || rosters.ok !== true) {
		unknown.push('rosters-stale');
	} else {
		const { teams, stale, oldestAgeSeconds, ttlSeconds } = rosters;
		const share =
			isNumber(stale) && isNumber(teams) ? `; ${stale} of ${teams} teams are stale` : '';
		if (!isNumber(ttlSeconds) || !isNumber(teams)) {
			findings.push({ id: 'rosters-stale', detail: 'roster ages were not reported' });
		} else if (teams === 0) {
			findings.push({ id: 'rosters-stale', detail: 'the database holds no teams' });
		} else if (isNumber(oldestAgeSeconds) && oldestAgeSeconds > ttlSeconds + ROSTER_GRACE_SECONDS) {
			findings.push({
				id: 'rosters-stale',
				detail: `the oldest roster was synced ${formatDuration(oldestAgeSeconds * 1000)} ago, and one is due a refresh after ${formatDuration(ttlSeconds * 1000)}${share}. The hourly sweep may have stopped`
			});
		}
	}

	const alerts = checks.alerts;
	if (!isRecord(alerts) || alerts.ok !== true) {
		unknown.push('alerts');
	} else {
		if (alerts.configured !== true) {
			findings.push({
				id: 'alerts',
				detail: 'the app has no alert webhook, so its own error alerts are going nowhere'
			});
		} else if (
			alerts.lastPostOk === false &&
			isNumber(alerts.lastPostAgeSeconds) &&
			alerts.lastPostAgeSeconds < ALERT_FAILURE_WINDOW_SECONDS
		) {
			findings.push({
				id: 'alerts',
				detail: `the app's last error alert, ${formatDuration(alerts.lastPostAgeSeconds * 1000)} ago, did not reach Discord. This clears when a later one arrives, or a day after the failure`
			});
		}
	}

	if (body.ok !== true && findings.length === 0) {
		findings.push({ id: 'status', detail: 'the report says the origin is not ok' });
	}

	const bootedAt =
		isRecord(body.process) && isNumber(body.process.bootedAt) ? body.process.bootedAt : null;
	if (bootedAt === null) unknown.push('restarts');
	return { findings, unknown, bootedAt };
}

/**
 * Proof that a page is the app's own and not a stand-in that happens to answer
 * 200: the tag the root layout puts in every page's head, and a reference to
 * SvelteKit's build output.
 */
const PAGE_MARKERS = ['og:site_name', '_app/immutable/'];

/**
 * The hostname of Cloudflare's Web Analytics script. The privacy page promises
 * no third-party analytics, and Cloudflare has injected this into every page
 * before without the repo changing; only the served HTML shows it.
 */
const BEACON_MARKER = 'cloudflareinsights';

export function evaluatePage(id: string, path: string, outcome: Outcome): Verdict {
	// A page that did not arrive says nothing about what Cloudflare adds to it.
	const failed = (detail: string): Verdict => ({ findings: [{ id, detail }], unknown: ['beacon'] });

	const failure = notOk(outcome);
	if (failure) return failed(failure);
	if (outcome.kind !== 'response') return failed('no response');

	if (!outcome.contentType.toLowerCase().includes('text/html')) {
		return failed(`answered 200 as ${quote(outcome.contentType || 'no content type', 40)}`);
	}
	if (!PAGE_MARKERS.every((marker) => outcome.body.includes(marker))) {
		const title = /<title[^>]*>([^<]{1,200})/i.exec(outcome.body)?.[1];
		return failed(
			`answered 200 with a page that is not the app's${title ? ` ${quote(title)}` : ''}`
		);
	}
	if (outcome.body.includes(BEACON_MARKER)) {
		return {
			findings: [
				{
					id: 'beacon',
					detail: `Cloudflare's analytics script is being injected into ${quote(path, 40)}, which the privacy page says does not happen. Turn off Web Analytics for the zone`
				}
			],
			unknown: []
		};
	}
	return { findings: [], unknown: [] };
}

const TITLES: Record<string, string> = {
	origin: 'Origin health check',
	status: 'Origin status report',
	site: 'Home page',
	edge: 'Privacy page, through the cache Worker',
	beacon: 'Third-party analytics',
	'disk-space': 'Disk space',
	'rosters-stale': 'Roster freshness',
	alerts: "The app's own alerts",
	restarts: 'Restarts'
};

function titleOf(id: string): string {
	const known = TITLES[id];
	if (known) return known;
	return id.startsWith('check:') ? `Origin check ${quote(id.slice('check:'.length), 40)}` : id;
}

/** One check's outage, from the first failing run until it is called recovered. */
export interface Incident {
	/** The first failing run. */
	since: number;
	/** Failing runs in a row; stops counting once the outage is announced. */
	failures: number;
	announcedAt: number | null;
	remindedAt: number | null;
	reminders: number;
	/** Passing runs in a row since it last failed, and when the first was. */
	passes: number;
	clearedAt: number | null;
}

/** Everything carried from one run to the next. */
export interface MonitorState {
	v: 1;
	incidents: Record<string, Incident>;
	boot: {
		/** The origin's boot time as last seen. */
		at: number | null;
		/** When each recent change in it was noticed. */
		changes: number[];
	};
}

export type Notice =
	| { kind: 'started'; failing: Finding[] }
	| { kind: 'down'; id: string; detail: string }
	| { kind: 'reminder'; id: string; detail: string; since: number }
	| { kind: 'recovered'; id: string; since: number; until: number };

export interface Observation extends Verdict {
	/** From `/api/status`; null when that could not be read. */
	bootedAt: number | null;
}

export function emptyState(): MonitorState {
	return { v: 1, incidents: {}, boot: { at: null, changes: [] } };
}

/**
 * The state as text, with the incidents in a fixed order: two runs that find
 * the same things in a different order must compare equal, or every one of
 * them would be written to KV.
 */
export function serialize(state: MonitorState): string {
	const incidents: Record<string, Incident> = {};
	for (const id of Object.keys(state.incidents).sort()) {
		const incident = state.incidents[id];
		if (incident) incidents[id] = incident;
	}
	return JSON.stringify({ v: state.v, incidents, boot: state.boot });
}

/** Null for anything that is not a state this version wrote. */
export function parseState(raw: string | null): MonitorState | null {
	if (raw === null) return null;
	const value = parseJson(raw);
	if (!isRecord(value) || value.v !== 1 || !isRecord(value.incidents) || !isRecord(value.boot)) {
		return null;
	}
	const incidents: Record<string, Incident> = {};
	for (const [id, entry] of Object.entries(value.incidents)) {
		if (!isRecord(entry) || !isNumber(entry.since) || !isNumber(entry.failures)) return null;
		incidents[id] = {
			since: entry.since,
			failures: entry.failures,
			announcedAt: isNumber(entry.announcedAt) ? entry.announcedAt : null,
			remindedAt: isNumber(entry.remindedAt) ? entry.remindedAt : null,
			reminders: isNumber(entry.reminders) ? entry.reminders : 0,
			passes: isNumber(entry.passes) ? entry.passes : 0,
			clearedAt: isNumber(entry.clearedAt) ? entry.clearedAt : null
		};
	}
	const { at, changes } = value.boot;
	return {
		v: 1,
		incidents,
		boot: {
			at: isNumber(at) ? at : null,
			changes: Array.isArray(changes) ? changes.filter(isNumber) : []
		}
	};
}

function reminderDue(incident: Incident, now: number): boolean {
	const last = incident.remindedAt ?? incident.announcedAt ?? now;
	const step = Math.min(incident.reminders, REMINDER_STEPS_MS.length - 1);
	// `step` is clamped to the array's bounds on the line above.
	return now - last >= REMINDER_STEPS_MS[step]!;
}

/**
 * One run's worth of bookkeeping: what to say, and what to remember.
 *
 * `prev` is null only on the very first run, which announces itself — that
 * message is how a new deployment is known to reach Discord at all.
 *
 * Nothing here changes on a run where nothing happened. A check that is passing
 * has no entry, an announced outage stops counting its failures, and the list
 * of restarts is only touched when one is added or ages out, so a steady state
 * costs no KV write whether it is steadily up or steadily down.
 */
export function advance(
	prev: MonitorState | null,
	observation: Observation,
	now: number
): { next: MonitorState; notices: Notice[]; failing: Finding[] } {
	const base = prev ?? emptyState();
	const notices: Notice[] = [];

	// A restart is a boot time that differs from the last one seen. The probe
	// looks every five minutes, so a machine restarting faster than that is
	// counted once per run, which is still several times inside the window.
	const boot = {
		at: base.boot.at,
		changes: base.boot.changes.filter((at) => now - at < RESTART_WINDOW_MS)
	};
	if (observation.bootedAt !== null) {
		if (boot.at !== null && boot.at !== observation.bootedAt) boot.changes.push(now);
		boot.at = observation.bootedAt;
	}

	const failing = new Map<string, Finding>();
	for (const finding of observation.findings) {
		if (!failing.has(finding.id)) failing.set(finding.id, finding);
	}
	if (boot.changes.length >= RESTART_LOOP_COUNT) {
		failing.set('restarts', {
			id: 'restarts',
			detail: `the machine has restarted ${boot.changes.length} times in the last ${formatDuration(RESTART_WINDOW_MS)}`
		});
	}

	if (prev === null) notices.push({ kind: 'started', failing: [...failing.values()] });

	const incidents: Record<string, Incident> = {};
	for (const { id, detail } of failing.values()) {
		const open = base.incidents[id];
		const incident: Incident = open
			? { ...open, passes: 0, clearedAt: null }
			: {
					since: now,
					failures: 0,
					announcedAt: null,
					remindedAt: null,
					reminders: 0,
					passes: 0,
					clearedAt: null
				};
		if (incident.announcedAt === null) {
			incident.failures += 1;
			if (incident.failures >= FAILURES_BEFORE_ALERT) {
				incident.announcedAt = now;
				notices.push({ kind: 'down', id, detail });
			}
		} else if (reminderDue(incident, now)) {
			incident.remindedAt = now;
			incident.reminders += 1;
			notices.push({ kind: 'reminder', id, detail, since: incident.since });
		}
		incidents[id] = incident;
	}

	const unknown = (id: string) =>
		observation.unknown.some((entry) =>
			entry.endsWith(':') ? id.startsWith(entry) : id === entry
		);

	for (const [id, open] of Object.entries(base.incidents)) {
		if (failing.has(id)) continue;
		// Not seen failing, but not seen passing either: left exactly as it was.
		if (unknown(id)) {
			incidents[id] = open;
			continue;
		}
		// Never announced, so there is nothing to take back: it was a blip.
		if (open.announcedAt === null) continue;
		const passes = open.passes + 1;
		const clearedAt = open.clearedAt ?? now;
		if (passes >= PASSES_BEFORE_RECOVERY) {
			notices.push({ kind: 'recovered', id, since: open.since, until: clearedAt });
		} else {
			incidents[id] = { ...open, passes, clearedAt };
		}
	}

	return { next: { v: 1, incidents, boot }, notices, failing: [...failing.values()] };
}

function bullet(id: string, text: string): string {
	return `• **${titleOf(id)}**: ${text}`;
}

function clip(content: string): string {
	return content.length > MAX_CONTENT ? `${content.slice(0, MAX_CONTENT - 1)}…` : content;
}

/** Everything one run has to say, as a single Discord message; null for nothing. */
export function formatNotices(notices: Notice[], now: number): string | null {
	if (notices.length === 0) return null;
	const sections: string[] = [];

	for (const notice of notices) {
		if (notice.kind !== 'started') continue;
		const minutes = RUN_INTERVAL_MS / MINUTE;
		sections.push(
			notice.failing.length === 0
				? `**numbrrs uptime monitor started.** Every check passed on the first run. It looks again every ${minutes} minutes and speaks only when that changes.`
				: [
						`**numbrrs uptime monitor started.** The first run found problems, which are announced if the next run finds them too:`,
						...notice.failing.map((finding) => bullet(finding.id, finding.detail))
					].join('\n')
		);
	}

	const down = notices.filter((notice) => notice.kind === 'down');
	if (down.length > 0) {
		sections.push(
			[
				`**numbrrs: ${down.length === 1 ? 'a check is' : `${down.length} checks are`} failing**`,
				...down.map((notice) => bullet(notice.id, notice.detail))
			].join('\n')
		);
	}

	const reminders = notices.filter((notice) => notice.kind === 'reminder');
	if (reminders.length > 0) {
		sections.push(
			[
				'**numbrrs: still failing**',
				...reminders.map((notice) =>
					bullet(notice.id, `for ${formatDuration(now - notice.since)}. ${notice.detail}`)
				)
			].join('\n')
		);
	}

	const recovered = notices.filter((notice) => notice.kind === 'recovered');
	if (recovered.length > 0) {
		sections.push(
			[
				'**numbrrs: recovered**',
				...recovered.map((notice) =>
					bullet(notice.id, `passing again after ${formatDuration(notice.until - notice.since)}`)
				)
			].join('\n')
		);
	}

	return clip(sections.join('\n\n'));
}

/**
 * What to say on a run that cannot rely on its memory: KV would not be read
 * and nothing is held from an earlier run, or would not take a write.
 * "Announce on the second failure" needs a first one to have been recorded, so
 * the rule would never fire and the monitor would sit silent through exactly
 * the outage it is for. Instead it says what is failing now, on the hour and
 * the half hour, and says why it is repeating itself.
 */
export function blindAlert(findings: Finding[], now: number): string | null {
	if (findings.length === 0 || now % BLIND_REPEAT_MS >= RUN_INTERVAL_MS) return null;
	return clip(
		[
			'**numbrrs: checks are failing, and the monitor cannot keep its state**',
			...findings.map((finding) => bullet(finding.id, finding.detail)),
			`Workers KV did not answer or would not take a write, so new failures cannot be told from old ones. This repeats every ${BLIND_REPEAT_MS / MINUTE} minutes while anything is failing, and a recovery may go unannounced.`
		].join('\n')
	);
}

/** The two KV methods this uses, so a test can stand in a Map. */
export interface StateStore {
	get(key: string): Promise<string | null>;
	put(key: string, value: string): Promise<unknown>;
}

export interface Env {
	/** The KV namespace bound in wrangler.uptime.toml. */
	UPTIME_STATE?: StateStore;
	/** A Worker secret: the Discord webhook to post to. */
	ALERT_WEBHOOK_URL?: string;
}

export interface MonitorDeps {
	fetch(url: string, init: RequestInit): Promise<Response>;
	sleep(ms: number): Promise<void>;
	log(entry: Record<string, unknown>): void;
}

function describeError(err: unknown): string {
	return err instanceof Error ? err.message || err.name : String(err);
}

/** Read a body as text, giving up on it once it is longer than any real page. */
async function readBody(response: Response): Promise<string> {
	if (!response.body) return '';
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let text = '';
	let bytes = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		bytes += value.byteLength;
		text += decoder.decode(value, { stream: true });
		if (bytes >= MAX_BODY_BYTES) {
			await reader.cancel();
			break;
		}
	}
	return text + decoder.decode();
}

async function request(deps: MonitorDeps, url: string, accept: string): Promise<Outcome> {
	try {
		const response = await deps.fetch(url, {
			headers: {
				accept,
				// Without this a localized page may answer with a redirect to /fr.
				'accept-language': 'en',
				'user-agent': USER_AGENT
			},
			// A redirect is an answer, and for every one of these URLs the wrong one.
			redirect: 'manual',
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		return {
			kind: 'response',
			status: response.status,
			contentType: response.headers.get('content-type') ?? '',
			body: await readBody(response)
		};
	} catch (err) {
		// By name, not by class: the timeout is thrown as a DOMException, and
		// whether that counts as an Error is the runtime's choice.
		const name = isRecord(err) ? err.name : undefined;
		const timedOut = name === 'TimeoutError' || name === 'AbortError';
		return {
			kind: 'error',
			reason: timedOut
				? `no answer within ${FETCH_TIMEOUT_MS / 1000} s`
				: `the request failed ${quote(describeError(err))}`
		};
	}
}

/** Ask, judge, and if the verdict is bad ask once more before believing it. */
async function probe<T extends Verdict>(
	deps: MonitorDeps,
	url: string,
	accept: string,
	evaluate: (outcome: Outcome) => T
): Promise<T> {
	const first = evaluate(await request(deps, url, accept));
	if (first.findings.length === 0) return first;
	await deps.sleep(RETRY_DELAY_MS);
	return evaluate(await request(deps, url, accept));
}

async function observe(deps: MonitorDeps): Promise<Observation> {
	const page = (id: string, path: string) =>
		probe(deps, `${SITE}${path}`, 'text/html', (outcome) => evaluatePage(id, path, outcome));

	const [health, status, site, edge] = await Promise.all([
		probe(deps, `${ORIGIN}/api/health`, 'application/json', evaluateHealth),
		probe(deps, `${ORIGIN}/api/status`, 'application/json', evaluateStatus),
		page('site', '/'),
		page('edge', '/privacy')
	]);

	const verdicts = [health, status, site, edge];
	return {
		findings: verdicts.flatMap((verdict) => verdict.findings),
		unknown: verdicts.flatMap((verdict) => verdict.unknown),
		bootedAt: status.bootedAt
	};
}

/**
 * Post to the webhook and say whether Discord took it. Never throws, and never
 * lets the URL into a log: it is a credential, and some fetch errors quote the
 * address they failed on.
 */
async function post(
	deps: MonitorDeps,
	webhook: string | undefined,
	content: string
): Promise<boolean> {
	// The message itself is logged either way. It holds nothing the channel
	// would not, and it is the only copy when the post fails.
	if (!webhook) {
		deps.log({ event: 'post', ok: false, detail: 'ALERT_WEBHOOK_URL is not set', content });
		return false;
	}
	let ok = false;
	let detail: string;
	try {
		const response = await deps.fetch(webhook, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			// Nothing in a message may ping anyone, whatever text ends up in it.
			body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		ok = response.ok;
		detail = `HTTP ${response.status}`;
		await response.body?.cancel();
	} catch (err) {
		detail = describeError(err).replaceAll(webhook, '<webhook>').slice(0, 200);
	}
	deps.log({ event: 'post', ok, detail, content });
	return ok;
}

/**
 * The monitor, with what it needs from the outside passed in. One is made per
 * isolate, and it holds one thing between runs: the newest state that KV
 * refused. An isolate often serves several runs, and when it does, a KV outage
 * costs nothing — the next run carries on from memory and tries the write
 * again. When it does not, `blindAlert` covers the gap.
 */
export function createMonitor(deps: MonitorDeps): (env: Env, now: number) => Promise<void> {
	let unsaved: MonitorState | undefined;

	async function silenced(store: StateStore | undefined): Promise<boolean> {
		try {
			return store !== undefined && (await store.get(SILENCE_KEY)) !== null;
		} catch {
			// If KV cannot say, the monitor is not silenced: the safe way to be wrong.
			return false;
		}
	}

	async function load(
		store: StateStore | undefined
	): Promise<{ available: boolean; state: MonitorState | null }> {
		if (!store) return { available: false, state: null };
		try {
			return { available: true, state: parseState(await store.get(STATE_KEY)) };
		} catch (err) {
			deps.log({ event: 'state', ok: false, detail: `read failed: ${describeError(err)}` });
			return { available: false, state: null };
		}
	}

	async function save(store: StateStore | undefined, state: MonitorState): Promise<boolean> {
		if (!store) return false;
		try {
			await store.put(STATE_KEY, serialize(state));
			return true;
		} catch (err) {
			deps.log({ event: 'state', ok: false, detail: `write failed: ${describeError(err)}` });
			return false;
		}
	}

	async function check(env: Env, now: number): Promise<void> {
		const store = env.UPTIME_STATE;
		if (await silenced(store)) {
			deps.log({ event: 'run', silenced: true });
			return;
		}

		const [observation, loaded] = await Promise.all([observe(deps), load(store)]);

		// With no memory at all the first run is not announced as one: it would be
		// announced again on every run until KV came back.
		const blind = unsaved === undefined && !loaded.available;
		const prev = unsaved ?? (blind ? emptyState() : loaded.state);
		const { next, notices, failing } = advance(prev, observation, now);

		const content = formatNotices(notices, now);
		const delivered = content === null ? null : await post(deps, env.ALERT_WEBHOOK_URL, content);

		// A notice nobody received is not recorded as given. The state stays where
		// it was, and the next run comes to the same conclusion and tries again.
		let saved = true;
		if (delivered !== false) {
			const changed = prev === null || unsaved !== undefined || serialize(prev) !== serialize(next);
			if (changed) {
				saved = await save(store, next);
				unsaved = saved ? undefined : next;
			}
		}

		if ((blind || !saved) && content === null) {
			const alert = blindAlert(failing, now);
			if (alert) await post(deps, env.ALERT_WEBHOOK_URL, alert);
		}

		deps.log({
			event: 'run',
			failing: failing.map((finding) => finding.id),
			notices: notices.map((notice) => notice.kind),
			delivered,
			state: blind ? 'none' : loaded.available ? 'kv' : 'memory',
			saved
		});
	}

	return async function run(env: Env, now: number): Promise<void> {
		try {
			await check(env, now);
		} catch (err) {
			// A bug here must not become a monitor that fails every run in silence;
			// nor one that says so 288 times a day.
			deps.log({ event: 'run', ok: false, detail: describeError(err) });
			if (now % BLIND_REPEAT_MS < RUN_INTERVAL_MS) {
				await post(
					deps,
					env.ALERT_WEBHOOK_URL,
					clip(
						`**numbrrs: the uptime monitor itself failed** ${quote(describeError(err), 200)}\nNothing is being checked until this is fixed. It repeats every ${BLIND_REPEAT_MS / MINUTE} minutes.`
					)
				);
			}
		}
	};
}

const monitor = createMonitor({
	fetch: (url, init) => fetch(url, init),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	// One JSON object per line, which Workers Logs indexes by field.
	log: (entry) => console.log(JSON.stringify(entry))
});

export default {
	// The runtime waits for the returned promise, so nothing needs `waitUntil`.
	async scheduled(controller: ScheduledController, env: Env): Promise<void> {
		await monitor(env, controller.scheduledTime);
	}
} satisfies ExportedHandler<Env>;
