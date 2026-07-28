/**
 * How long to leave a failing sync alone. Kept separate from the sync layer
 * because the policy is pure arithmetic and the sync layer opens a database at
 * import — this way the schedule can be tested without one.
 *
 * The problem it solves: freshness is only recorded on success, so without
 * failure tracking a league that is down looks exactly like one that has never
 * been synced, and gets asked again on every request — roughly six attempts a
 * minute per failing league, forever. `once()` bounds how many run at a time
 * but not how often they repeat.
 */

/**
 * Doubling from one minute, capped at thirty: 1, 2, 4, 8, 16, 30, 30, …
 *
 * The first delay is deliberately short. Most failures are blips, and a minute
 * is long enough to stop hammering an upstream while short enough that someone
 * reloading just after an outage ends isn't told to come back much later.
 */
export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export interface FailureState {
	/** When the most recent consecutive failure happened, or null if none has. */
	failedAt: number | null;
	/** How many consecutive failures. Zero once anything succeeds. */
	failureCount: number;
}

/** How long to wait after the nth consecutive failure. */
export function backoffDelay(failureCount: number): number {
	if (failureCount < 1) return 0;
	// 2 ** a large count is Infinity, which Math.min caps — nothing to guard.
	return Math.min(BACKOFF_BASE_MS * 2 ** (failureCount - 1), BACKOFF_MAX_MS);
}

/**
 * Whether a key is still inside the window from its last failure, and should be
 * left alone rather than retried.
 */
export function inBackoff(state: FailureState | undefined | null, now: number): boolean {
	if (!state?.failedAt || state.failureCount < 1) return false;
	return now < state.failedAt + backoffDelay(state.failureCount);
}
