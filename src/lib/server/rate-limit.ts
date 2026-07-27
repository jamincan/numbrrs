/**
 * Sliding-window rate limiting, in memory.
 *
 * In-memory is the right shape while the app runs as a single machine, which it
 * does for reasons that have nothing to do with this file — the Fly volume binds
 * SQLite to one machine, and the sync layer's coalescing state is per-process.
 * If that ever changes, every limit here becomes per-instance and therefore N
 * times looser than it reads. Nothing enforces that; it is a comment because it
 * is a real constraint rather than a hidden one.
 *
 * Time is a parameter rather than read from the clock, so the tests can walk a
 * window forward without sleeping through it.
 */

export interface RateLimitOptions {
	/** Attempts allowed per key within `windowMs`. */
	limit: number;
	windowMs: number;
	/**
	 * Optional ceiling across every key combined, for when the thing being
	 * protected is a shared resource rather than the caller.
	 *
	 * Leave it off for anything a legitimate user needs to reach. A shared
	 * ceiling means one attacker spending the budget locks everyone else out,
	 * which on a login form hands them a denial of service in exchange for the
	 * brute-force protection the per-key limit already provides.
	 */
	globalLimit?: number;
	/** Defaults to `windowMs`. */
	globalWindowMs?: number;
	/** Ceiling on tracked keys, so a flood from many addresses can't grow the map without bound. */
	maxKeys?: number;
}

export interface RateLimiter {
	/**
	 * Records an attempt and reports whether it is permitted. Rejected attempts
	 * are deliberately not recorded — counting them would let a caller who is
	 * already over the limit hold themselves there indefinitely, turning a
	 * rate limit into a lockout.
	 */
	allow(key: string, now: number): boolean;
	/** Tracked key count. Exposed for tests to assert the map stays bounded. */
	size(): number;
}

export function createRateLimiter({
	limit,
	windowMs,
	globalLimit,
	globalWindowMs = windowMs,
	maxKeys = 1000
}: RateLimitOptions): RateLimiter {
	const hitsByKey = new Map<string, number[]>();
	let globalHits: number[] = [];

	/**
	 * Drop keys whose attempts have all aged out. If that isn't enough — every
	 * tracked key is currently active, which is what a distributed flood looks
	 * like — evict the least recently seen until the map is back under the
	 * ceiling, so memory is bounded by configuration rather than by traffic.
	 */
	function prune(now: number): void {
		for (const [key, times] of hitsByKey) {
			if (times.every((t) => now - t >= windowMs)) hitsByKey.delete(key);
		}
		if (hitsByKey.size <= maxKeys) return;

		const byAge = [...hitsByKey.entries()].sort((a, b) => last(a[1]) - last(b[1]));
		for (const [key] of byAge.slice(0, hitsByKey.size - maxKeys)) {
			hitsByKey.delete(key);
		}
	}

	return {
		allow(key, now) {
			if (globalLimit !== undefined) {
				globalHits = globalHits.filter((t) => now - t < globalWindowMs);
				if (globalHits.length >= globalLimit) return false;
			}

			const hits = (hitsByKey.get(key) ?? []).filter((t) => now - t < windowMs);
			if (hits.length >= limit) {
				// Store the pruned list so the window keeps sliding even while the
				// caller is being turned away.
				hitsByKey.set(key, hits);
				return false;
			}

			hits.push(now);
			hitsByKey.set(key, hits);
			if (globalLimit !== undefined) globalHits.push(now);

			if (hitsByKey.size > maxKeys) prune(now);

			return true;
		},

		size() {
			return hitsByKey.size;
		}
	};
}

function last(times: number[]): number {
	return times[times.length - 1] ?? 0;
}
