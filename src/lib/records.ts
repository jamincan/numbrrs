/**
 * What a player has achieved, as it is kept in their own browser: medals and
 * best scores per team and season, and which players they have ever named
 * correctly. Pure functions over plain data, so they can be unit tested; the
 * reading and writing of storage is in records.svelte.ts.
 *
 * None of this is ever sent to the server. That is the point of keeping it
 * here: records without accounts, and nothing about a visitor to look after.
 */

import { isLevelKey, levelFor, type LevelKey, type Medal } from '#lib/game.ts';

/** The localStorage key. Named on the privacy page. */
export const RECORDS_KEY = 'numbrrs_records';

// Bumped if the stored shape ever changes incompatibly. A record written by a
// newer build than the one reading it is left alone rather than overwritten.
const VERSION = 1;

/** Players found on the first try, out of how many there were to find. */
export type Score = [found: number, total: number];

export interface SeasonRecord {
	/** The best medal earned for the team this season. */
	medal?: Medal;
	/** The best finished run at each level. */
	best: Partial<Record<LevelKey, Score>>;
}

export interface TeamRecord {
	/** Keyed by the year the season started in: see `seasonOf`. */
	seasons: Record<string, SeasonRecord>;
	/**
	 * Every player ever answered correctly for this team, as `id:number`. A
	 * player who changes number is a new entry: it is the number that was
	 * learned. Kept across seasons, for telling who on a roster is new.
	 */
	known: string[];
	/** Whether the roster has ever been played to the end, at any level. */
	completed: boolean;
}

export interface Records {
	v: typeof VERSION;
	/** Keyed by team id, e.g. `nhl:TOR`. */
	teams: Record<string, TeamRecord>;
}

export function emptyRecords(): Records {
	return { v: VERSION, teams: {} };
}

/**
 * The season a date falls in, as the year it started. Every league's season is
 * taken to turn over on September 1, by the clock of whoever is playing: the
 * records are theirs, and so is the calendar they are kept by.
 */
export function seasonOf(date: Date): number {
	return date.getMonth() >= 8 ? date.getFullYear() : date.getFullYear() - 1;
}

/** The season it is now, for whoever is playing. */
export function currentSeason(): number {
	return seasonOf(new Date());
}

const MEDAL_ORDER: readonly Medal[] = ['bronze', 'silver', 'gold'];

function isMedal(value: unknown): value is Medal {
	return MEDAL_ORDER.includes(value as Medal);
}

/** The more valuable of two medals, either of which may be missing. */
export function betterMedal(a: Medal | undefined, b: Medal | undefined): Medal | undefined {
	if (!a) return b;
	if (!b) return a;
	return MEDAL_ORDER.indexOf(a) >= MEDAL_ORDER.indexOf(b) ? a : b;
}

function isScore(value: unknown): value is Score {
	if (!Array.isArray(value) || value.length !== 2) return false;
	const [found, total] = value as unknown[];
	return (
		Number.isSafeInteger(found) &&
		Number.isSafeInteger(total) &&
		(found as number) >= 0 &&
		(total as number) >= 1 &&
		(found as number) <= (total as number)
	);
}

/** Whether a score beats, or matches, the one already held. A larger share of
 *  the roster wins; rosters change size, so the counts alone can't be compared. */
function atLeastAsGood(score: Score, held: Score | undefined): boolean {
	return !held || score[0] * held[1] >= held[0] * score[1];
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSeason(value: unknown): SeasonRecord | null {
	if (!isObject(value)) return null;
	const season: SeasonRecord = { best: {} };
	if (isMedal(value.medal)) season.medal = value.medal;
	if (isObject(value.best)) {
		for (const [level, score] of Object.entries(value.best)) {
			if (isLevelKey(level) && isScore(score)) season.best[level] = [score[0], score[1]];
		}
	}
	return season;
}

function parseTeam(value: unknown): TeamRecord | null {
	if (!isObject(value)) return null;
	const team: TeamRecord = { seasons: {}, known: [], completed: value.completed === true };
	if (isObject(value.seasons)) {
		for (const [year, raw] of Object.entries(value.seasons)) {
			const season = /^\d{4}$/.test(year) ? parseSeason(raw) : null;
			if (season) team.seasons[year] = season;
		}
	}
	if (Array.isArray(value.known)) {
		team.known = [
			...new Set(
				value.known.filter((k): k is string => typeof k === 'string' && /^\d+:\d+$/.test(k))
			)
		];
	}
	return team;
}

/**
 * Read stored records. Storage is outside the app's control (another tab, an
 * older build, a hand-edited value), so nothing in it is trusted: whatever is
 * not a record is left out, and what remains is kept. Null means the value was
 * written by a newer build, and must not be replaced by this one's idea of it.
 */
export function parseRecords(raw: string | null): Records | null {
	if (raw === null) return emptyRecords();
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return emptyRecords();
	}
	if (!isObject(data)) return emptyRecords();
	if (typeof data.v === 'number' && data.v > VERSION) return null;
	const records = emptyRecords();
	if (isObject(data.teams)) {
		for (const [id, raw] of Object.entries(data.teams)) {
			const team = parseTeam(raw);
			if (team) records.teams[id] = team;
		}
	}
	return records;
}

function withTeam(
	records: Records,
	teamId: string,
	change: (team: TeamRecord) => TeamRecord
): Records {
	const team = records.teams[teamId] ?? { seasons: {}, known: [], completed: false };
	return { ...records, teams: { ...records.teams, [teamId]: change(team) } };
}

export interface FinishedRun {
	/** The level the run counts as: the easiest one used during it. */
	level: LevelKey;
	/** Players found on the first try. */
	found: number;
	/** Players there were to find. */
	total: number;
}

/**
 * Record a roster played to the end. The score is kept if it is the best at
 * its level this season, and a run with no misses earns the level's medal,
 * which is kept if it is the best the team has this season. Nothing recorded
 * is ever taken away by a later run. Returns new records; the input is not
 * mutated.
 */
export function recordRun(
	records: Records,
	teamId: string,
	season: number,
	run: FinishedRun
): Records {
	if (run.total < 1) return records;
	return withTeam(records, teamId, (team) => {
		const held = team.seasons[season] ?? { best: {} };
		const score: Score = [run.found, run.total];
		const next: SeasonRecord = {
			...held,
			best: atLeastAsGood(score, held.best[run.level])
				? { ...held.best, [run.level]: score }
				: held.best
		};
		const earned = run.found === run.total ? (levelFor(run.level).medal ?? undefined) : undefined;
		const medal = betterMedal(held.medal, earned);
		if (medal) next.medal = medal;
		return { ...team, completed: true, seasons: { ...team.seasons, [season]: next } };
	});
}

/** Note that a player has been named correctly. Returns the same records when
 *  they were known already, so a caller can tell there is nothing to save. */
export function recordKnown(
	records: Records,
	teamId: string,
	playerId: number,
	sweaterNumber: number
): Records {
	const key = `${playerId}:${sweaterNumber}`;
	if (records.teams[teamId]?.known.includes(key)) return records;
	return withTeam(records, teamId, (team) => ({ ...team, known: [...team.known, key] }));
}

/** The team's medal for a season, if it has one. */
export function teamMedal(records: Records, teamId: string, season: number): Medal | null {
	return records.teams[teamId]?.seasons[season]?.medal ?? null;
}

/** The best finished run for a team at a level in a season. */
export function teamBest(
	records: Records,
	teamId: string,
	season: number,
	level: LevelKey
): Score | null {
	return records.teams[teamId]?.seasons[season]?.best[level] ?? null;
}

/** How many of these teams hold gold for a season. */
export function goldCount(records: Records, teamIds: readonly string[], season: number): number {
	return teamIds.filter((id) => teamMedal(records, id, season) === 'gold').length;
}

/** Whether there is anything recorded at all, for the reset control. */
export function hasRecords(records: Records): boolean {
	return Object.keys(records.teams).length > 0;
}

// ---- who on a roster is new ----

const MARK_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** How many characters stand for one player in a roster's marks. */
export const MARK_LENGTH = 3;

/**
 * A short stand-in for one player wearing one number: three characters,
 * eighteen bits of a hash of the two. The home page is sent these for every
 * roster so it can count the players a visitor has not yet named, and they are
 * this small because every visitor is sent them, whether or not they have a
 * record to compare with. Two different players sharing a mark is possible and
 * rare (one chance in 262,144 for any pair), and costs a count that is off by
 * one.
 */
export function mark(playerId: number, sweaterNumber: number): string {
	// FNV-1a, 32 bits, over the same `id:number` text the records keep.
	let hash = 0x811c9dc5;
	for (const char of `${playerId}:${sweaterNumber}`) {
		hash ^= char.charCodeAt(0);
		hash = Math.imul(hash, 0x01000193);
	}
	const bits = (hash ^ (hash >>> 18)) & 0x3ffff;
	return (
		MARK_ALPHABET[bits >>> 12]! + MARK_ALPHABET[(bits >>> 6) & 63]! + MARK_ALPHABET[bits & 63]!
	);
}

/** The marks of everyone on a roster who has a number, run together. */
export function rosterMarks(
	roster: readonly { id: number; sweaterNumber: number | null }[]
): string {
	return roster.map((p) => (p.sweaterNumber == null ? '' : mark(p.id, p.sweaterNumber))).join('');
}

/** A team's known players, as the marks they would have on a roster. */
function knownMarks(team: TeamRecord): Set<string> {
	return new Set(
		team.known.map((key) => {
			const [id, sweaterNumber] = key.split(':').map(Number);
			return mark(id!, sweaterNumber!);
		})
	);
}

/**
 * How many players on a roster, given as its marks, this visitor has not yet
 * named: arrivals, and players who have changed number, since they last played
 * it through. Nothing for a team they have never finished, where everyone
 * would be new and the count would say nothing.
 */
export function newCount(records: Records, teamId: string, marks: string): number {
	const team = records.teams[teamId];
	if (!team?.completed) return 0;
	const known = knownMarks(team);
	let count = 0;
	for (let at = 0; at + MARK_LENGTH <= marks.length; at += MARK_LENGTH) {
		if (!known.has(marks.slice(at, at + MARK_LENGTH))) count += 1;
	}
	return count;
}

/** The same players, from the roster itself: who a round of Learn for the new
 *  arrivals is about. */
export function newPlayers<P extends { id: number; sweaterNumber: number | null }>(
	records: Records,
	teamId: string,
	roster: readonly P[]
): P[] {
	const team = records.teams[teamId];
	if (!team?.completed) return [];
	return roster.filter(
		(p) => p.sweaterNumber != null && !team.known.includes(`${p.id}:${p.sweaterNumber}`)
	);
}
