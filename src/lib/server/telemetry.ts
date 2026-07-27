import { createHash } from 'node:crypto';

/**
 * The pure half of usage tracking and error reporting: day bucketing, visitor
 * hashing, bot detection, referrer trimming, and error fingerprinting.
 *
 * Kept clear of the database and the environment so the rules that decide what
 * gets counted — and what collapses into one alert — can be tested directly,
 * without opening a SQLite file to do it.
 */

/**
 * Days are bucketed in the app's home timezone rather than UTC, so "yesterday"
 * on the dashboard means the yesterday you lived through. A UTC boundary would
 * cut each day at 8pm local and split every evening's traffic in two.
 */
const DAY_TIMEZONE = 'America/Toronto';

/** en-CA formats as YYYY-MM-DD, which sorts correctly as text. */
const dayFormatter = new Intl.DateTimeFormat('en-CA', {
	timeZone: DAY_TIMEZONE,
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
});

export function dayKey(at: number): string {
	return dayFormatter.format(at);
}

/**
 * At this app's scale crawlers comfortably outnumber people, so an unfiltered
 * count answers "how busy is Googlebot" rather than "is this growing". Matching
 * on the user agent is crude and always will be — well-behaved bots announce
 * themselves and the rest don't — but it removes the bulk of the noise.
 */
const BOT_PATTERN =
	/bot|crawler|spider|crawling|slurp|facebookexternalhit|embedly|quora link preview|pinterest|vkshare|w3c_validator|whatsapp|flipboard|tumblr|skypeuripreview|nuzzel|chrome-lighthouse|headlesschrome|curl\/|wget\/|python-requests|okhttp|go-http-client|node-fetch|axios|monitor|uptime|pingdom|gtmetrix|semrush|ahrefs|mj12|dotbot|bytespider|applebot|amazonbot|ccbot/i;

export function isBot(userAgent: string): boolean {
	// No user agent at all is a script, a health check, or something hiding.
	// Either way it isn't someone playing the game.
	return userAgent.trim() === '' || BOT_PATTERN.test(userAgent);
}

/**
 * A per-day pseudonym for a visitor. The salt is generated fresh each day by
 * the caller and never written down, which is the whole privacy argument:
 * within a day we can tell two visitors apart, and once the salt is gone
 * nobody — including us — can link today's hashes to tomorrow's or work
 * backwards to an IP.
 */
export function visitorHash(salt: Buffer, day: string, ip: string, userAgent: string): string {
	return createHash('sha256')
		.update(salt)
		.update(`${day}\n${ip}\n${userAgent}`)
		.digest('hex')
		.slice(0, 16);
}

/**
 * The referring site, host only. The full referrer would record which page on
 * Discord or Google someone came from, which is more than "where is traffic
 * coming from" needs. Our own hosts are dropped so internal navigation doesn't
 * drown out the real referrers.
 */
export function referrerHost(referer: string | null, ownHosts: string[]): string | null {
	if (!referer) return null;
	try {
		const host = new URL(referer).hostname;
		if (ownHosts.includes(host)) return null;
		return host.slice(0, 100);
	} catch {
		return null;
	}
}

/** A stack trace that doesn't fit in these limits isn't one anybody will read. */
export const MAX_MESSAGE = 500;
export const MAX_STACK = 900;

export function truncate(value: string, max: number): string {
	return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * Collapse the parts of a message that vary per occurrence so the same bug
 * lands on the same row. Without this, "team 42 not found" and "team 43 not
 * found" are two errors, each with its own notification cooldown, and the
 * burst limit is what ends up protecting the alert channel instead.
 */
export function normalizeMessage(message: string): string {
	return message
		.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
		.replace(/0x[0-9a-f]+/gi, '<hex>')
		.replace(/\b\d{2,}\b/g, '<n>')
		.slice(0, MAX_MESSAGE);
}

export function fingerprintOf(source: string, message: string, route: string | null): string {
	return createHash('sha256')
		.update(`${source}\n${normalizeMessage(message)}\n${route ?? ''}`)
		.digest('hex')
		.slice(0, 16);
}
