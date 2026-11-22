import { browser } from '$app/env';
import type { LevelKey, Medal } from '#lib/game.ts';
import {
	emptyRecords,
	goldCount,
	hasRecords,
	newCount,
	newPlayers,
	parseRecords,
	recordKnown,
	recordRun,
	RECORDS_KEY,
	currentSeason,
	teamBest,
	teamMedal,
	type FinishedRun,
	type Records,
	type Score
} from '#lib/records.ts';

/**
 * A player's records, read from and written to this browser's local storage.
 *
 * A new instance holds nothing and says so (`loaded` is false): the pages that
 * show records are rendered on the server and shared by every visitor, so
 * nothing from storage can be in the markup or in the first client render that
 * has to match it. A page calls `load` once it has mounted.
 *
 * Created per page, like the game's own state, never at module level: a
 * module-level `$state` on the server would be shared between requests.
 */
export class RecordBook {
	#data = $state<Records>(emptyRecords());
	loaded = $state(false);
	/** The season records are read and written for: see `seasonOf`. */
	season = $state(currentSeason());
	// Set when storage holds records from a newer build than this one. They
	// are left as they are: nothing is shown from them, and nothing is written
	// over them.
	#readOnly = false;

	load(): void {
		if (!browser) return;
		this.season = currentSeason();
		// Reading is wrapped because localStorage throws rather than degrading
		// when storage is unavailable. Someone whose browser can't keep a record
		// can still play; they just start from nothing each visit.
		try {
			const parsed = parseRecords(localStorage.getItem(RECORDS_KEY));
			this.#readOnly = parsed === null;
			this.#data = parsed ?? emptyRecords();
		} catch {
			this.#data = emptyRecords();
		}
		this.loaded = true;
	}

	#write(next: Records): void {
		if (next === this.#data) return;
		this.#data = next;
		if (!browser || this.#readOnly) return;
		try {
			localStorage.setItem(RECORDS_KEY, JSON.stringify(next));
		} catch {
			// Kept in memory for this visit, which is all that can be done.
		}
	}

	/** A roster played to the end. */
	runFinished(teamId: string, run: FinishedRun): void {
		if (!this.loaded) return;
		this.#write(recordRun(this.#data, teamId, this.season, run));
	}

	/** A player named correctly. */
	learned(teamId: string, playerId: number, sweaterNumber: number): void {
		if (!this.loaded) return;
		this.#write(recordKnown(this.#data, teamId, playerId, sweaterNumber));
	}

	medal(teamId: string): Medal | null {
		return teamMedal(this.#data, teamId, this.season);
	}

	best(teamId: string, level: LevelKey): Score | null {
		return teamBest(this.#data, teamId, this.season, level);
	}

	golds(teamIds: readonly string[]): number {
		return goldCount(this.#data, teamIds, this.season);
	}

	/** How many players on a roster, given as its marks, are new to this visitor. */
	newCount(teamId: string, marks: string): number {
		return newCount(this.#data, teamId, marks);
	}

	/** Those players, from the roster itself. */
	newPlayers<P extends { id: number; sweaterNumber: number | null }>(
		teamId: string,
		roster: readonly P[]
	): P[] {
		return newPlayers(this.#data, teamId, roster);
	}

	get any(): boolean {
		return hasRecords(this.#data);
	}

	/** Erase everything recorded in this browser. */
	reset(): void {
		this.#data = emptyRecords();
		this.#readOnly = false;
		if (!browser) return;
		try {
			localStorage.removeItem(RECORDS_KEY);
		} catch {
			// Nothing was being kept, then.
		}
	}
}
