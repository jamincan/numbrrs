import { describe, expect, it } from 'vitest';
import { BACKOFF_MAX_MS, backoffDelay, inBackoff } from './backoff';

const MINUTE = 60_000;
const NOW = 1_800_000_000_000;

describe('backoffDelay', () => {
	it('doubles from one minute', () => {
		expect(backoffDelay(1)).toBe(1 * MINUTE);
		expect(backoffDelay(2)).toBe(2 * MINUTE);
		expect(backoffDelay(3)).toBe(4 * MINUTE);
		expect(backoffDelay(4)).toBe(8 * MINUTE);
		expect(backoffDelay(5)).toBe(16 * MINUTE);
	});

	it('caps at thirty minutes rather than growing forever', () => {
		expect(backoffDelay(6)).toBe(BACKOFF_MAX_MS);
		expect(backoffDelay(20)).toBe(BACKOFF_MAX_MS);
		// 2 ** 2000 is Infinity; the cap has to survive that rather than produce NaN.
		expect(backoffDelay(2000)).toBe(BACKOFF_MAX_MS);
	});

	it('is zero when nothing has failed', () => {
		expect(backoffDelay(0)).toBe(0);
		expect(backoffDelay(-1)).toBe(0);
	});
});

describe('inBackoff', () => {
	it('holds off inside the window and releases after it', () => {
		const state = { failedAt: NOW, failureCount: 1 };

		expect(inBackoff(state, NOW)).toBe(true);
		expect(inBackoff(state, NOW + MINUTE - 1)).toBe(true);
		// The boundary is exclusive: at exactly the delay, retrying is allowed.
		expect(inBackoff(state, NOW + MINUTE)).toBe(false);
		expect(inBackoff(state, NOW + 5 * MINUTE)).toBe(false);
	});

	it('holds off longer as failures accumulate', () => {
		const once = { failedAt: NOW, failureCount: 1 };
		const thrice = { failedAt: NOW, failureCount: 3 };

		const twoMinutesLater = NOW + 2 * MINUTE;
		expect(inBackoff(once, twoMinutesLater)).toBe(false);
		expect(inBackoff(thrice, twoMinutesLater)).toBe(true);
	});

	it('never holds off a key that has not failed', () => {
		expect(inBackoff(undefined, NOW)).toBe(false);
		expect(inBackoff(null, NOW)).toBe(false);
		expect(inBackoff({ failedAt: null, failureCount: 0 }, NOW)).toBe(false);
	});

	it('treats a cleared failure as no failure even if the count survived', () => {
		// Belt and braces: markSynced clears both columns, but a row with a count
		// and no timestamp must not be read as "wait forever".
		expect(inBackoff({ failedAt: null, failureCount: 7 }, NOW)).toBe(false);
	});

	it('does not hold off on a count of zero with a stale timestamp', () => {
		expect(inBackoff({ failedAt: NOW, failureCount: 0 }, NOW)).toBe(false);
	});

	it('stops holding off eventually, however long the streak', () => {
		// The cap is what guarantees a permanently-failing league is still retried
		// twice an hour rather than being abandoned.
		const state = { failedAt: NOW, failureCount: 500 };
		expect(inBackoff(state, NOW + BACKOFF_MAX_MS - 1)).toBe(true);
		expect(inBackoff(state, NOW + BACKOFF_MAX_MS)).toBe(false);
	});
});
