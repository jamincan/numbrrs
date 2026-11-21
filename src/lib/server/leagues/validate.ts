import { z, type ZodType } from 'zod';

/*
 * Content limits for feed values, on top of the shape checks in each adapter.
 * A team code becomes a URL segment and a database id, and names are rendered
 * on every page, so "any string" is too wide a contract for either.
 *
 * Each limit is a few times the largest value in a full sync of all five
 * leagues (101 teams, 2,848 players), which is noted beside it. They are there
 * to refuse garbage, not to police the feed: a limit that a real name or a new
 * team could plausibly reach is set too low.
 */

/**
 * A team code as the app uses it, after any normalizing: real ones are two to
 * four capital letters. Capitals only because the game route uppercases the
 * code it is asked for, so a code stored in any other case could never be
 * opened.
 */
export const TEAM_CODE = /^[A-Z0-9]{2,8}$/;

/** Longest real one is 28 characters ("Blainville-Boisbriand Armada"). */
export const teamNameSchema = z.string().max(80);

/**
 * Longest real ones are 15 (first) and 18 (last). No character rule: real names
 * carry accents from a dozen alphabets, hyphens, spaces, periods and both
 * straight and curly apostrophes, and they are only ever rendered as text.
 */
export const playerNameSchema = z.string().max(64);

/**
 * One or two letters in every feed, and empty for the odd training-camp
 * invitee. Anything the app doesn't recognize is grouped under "Other", so the
 * length is all that matters.
 */
export const positionSchema = z.string().max(8);

/** Largest real id is 8,486,166, in the NHL. */
export const PLAYER_ID_MAX = 999_999_999;

/**
 * A logo or headshot address: `https:` and no longer than 512 characters (the
 * longest real one is 67). One that isn't becomes an empty string, the same as
 * a feed that sends no image at all — a picture is never worth a team or a
 * player. The host is deliberately not checked: a league moving to another CDN
 * must not blank its images.
 */
export const imageUrlSchema = z
	.string()
	.max(512)
	.regex(/^https:\/\/\S+$/)
	.catch('');

/**
 * A sweater number, or null for a value no sweater carries. Real ones run 0–99
 * (0–98 in the measured data). Training-camp rosters list everyone still
 * waiting on a number as #999, which the game would otherwise quiz as one
 * number with dozens of right answers — so an out-of-range number costs the
 * player their number, not their place on the roster.
 */
export function sweaterNumber(value: number | undefined): number | null {
	return value !== undefined && Number.isInteger(value) && value >= 0 && value <= 99 ? value : null;
}

/**
 * Raised when an external feed stops matching the shape we parse it into.
 *
 * Deliberately its own type rather than a plain Error. A timeout is worth
 * retrying and a schema change never is — the next request returns exactly the
 * same thing — and the sync layer's retry decision keys off that difference. It
 * also means "the NHL renamed a field" shows up in the logs as its own class of
 * failure instead of blending into the network blips.
 */
export class FeedSchemaError extends Error {
	constructor(context: string, detail: string) {
		super(`${context} schema mismatch — ${detail}`);
		this.name = 'FeedSchemaError';
	}
}

/** Past a handful, listing issues stops being a diagnosis and starts being noise. */
const MAX_REPORTED_ISSUES = 3;

/**
 * Validate a payload from a feed we don't control, naming the field that moved.
 *
 * The point is the log line. `roster.forwards.0.firstName: invalid type` tells
 * you the NHL flattened a name object and roughly how long the fix takes;
 * "sync failed" tells you nothing and costs an afternoon.
 */
export function parseFeed<T>(schema: ZodType<T>, value: unknown, context: string): T {
	const result = schema.safeParse(value);
	if (result.success) return result.data;

	const { issues } = result.error;
	const detail = issues
		.slice(0, MAX_REPORTED_ISSUES)
		.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('; ');
	const rest = issues.length - MAX_REPORTED_ISSUES;

	throw new FeedSchemaError(context, rest > 0 ? `${detail} (+${rest} more)` : detail);
}
