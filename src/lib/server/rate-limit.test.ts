import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';

const MINUTE = 60 * 1000;

describe('createRateLimiter', () => {
	it('allows up to the limit and then refuses', () => {
		const limiter = createRateLimiter({ limit: 3, windowMs: MINUTE });

		expect(limiter.allow('a', 0)).toBe(true);
		expect(limiter.allow('a', 1)).toBe(true);
		expect(limiter.allow('a', 2)).toBe(true);
		expect(limiter.allow('a', 3)).toBe(false);
	});

	it('slides: attempts leave the window as it moves', () => {
		const limiter = createRateLimiter({ limit: 2, windowMs: MINUTE });

		limiter.allow('a', 0);
		limiter.allow('a', 30_000);
		expect(limiter.allow('a', 40_000)).toBe(false);

		// The first attempt has aged out by now, the second has not.
		expect(limiter.allow('a', MINUTE + 1)).toBe(true);
		expect(limiter.allow('a', MINUTE + 2)).toBe(false);
	});

	it('keeps keys independent', () => {
		const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE });

		expect(limiter.allow('a', 0)).toBe(true);
		expect(limiter.allow('a', 1)).toBe(false);
		expect(limiter.allow('b', 1)).toBe(true);
	});

	it('does not count refused attempts, so a caller cannot hold itself out', () => {
		const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE });

		expect(limiter.allow('a', 0)).toBe(true);
		// Hammering throughout the window must not push the original attempt's
		// expiry forward.
		for (let t = 1; t < MINUTE; t += 1000) limiter.allow('a', t);

		expect(limiter.allow('a', MINUTE + 1)).toBe(true);
	});

	describe('global ceiling', () => {
		it('refuses across keys once the shared budget is spent', () => {
			const limiter = createRateLimiter({
				limit: 5,
				windowMs: MINUTE,
				globalLimit: 2,
				globalWindowMs: MINUTE
			});

			expect(limiter.allow('a', 0)).toBe(true);
			expect(limiter.allow('b', 1)).toBe(true);
			// Neither key is near its own limit; the shared one is spent.
			expect(limiter.allow('c', 2)).toBe(false);
		});

		it('releases the shared budget as its own window slides', () => {
			const limiter = createRateLimiter({
				limit: 5,
				windowMs: MINUTE,
				globalLimit: 1,
				globalWindowMs: 10 * MINUTE
			});

			expect(limiter.allow('a', 0)).toBe(true);
			expect(limiter.allow('b', MINUTE)).toBe(false);
			expect(limiter.allow('b', 10 * MINUTE + 1)).toBe(true);
		});

		it('is absent unless configured, so one caller cannot lock out the rest', () => {
			const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE });

			for (let i = 0; i < 50; i++) limiter.allow(`attacker-${i}`, 0);

			expect(limiter.allow('the-real-admin', 1)).toBe(true);
		});
	});

	describe('memory', () => {
		it('forgets keys whose attempts have aged out', () => {
			const limiter = createRateLimiter({ limit: 1, windowMs: MINUTE, maxKeys: 10 });

			// Exactly at the ceiling, so nothing has been swept or evicted yet.
			for (let i = 0; i < 10; i++) limiter.allow(`key-${i}`, 0);
			expect(limiter.size()).toBe(10);

			// One fresh attempt after everything else has expired pushes past the
			// ceiling, and the sweep finds all ten stale.
			limiter.allow('late', MINUTE + 1);
			expect(limiter.size()).toBe(1);
		});

		it('stays bounded when every key is still active', () => {
			const limiter = createRateLimiter({ limit: 5, windowMs: MINUTE, maxKeys: 10 });

			// A distributed flood: nothing has aged out, so the sweep cannot help
			// and the eviction path is what has to hold the line.
			for (let i = 0; i < 500; i++) limiter.allow(`flood-${i}`, i);

			expect(limiter.size()).toBeLessThanOrEqual(11);
		});

		it('evicts the least recently seen first', () => {
			const limiter = createRateLimiter({ limit: 5, windowMs: MINUTE, maxKeys: 2 });

			limiter.allow('oldest', 0);
			limiter.allow('newer', 1);
			limiter.allow('newest', 2);
			// Over the ceiling with nothing expired, so 'oldest' is dropped.
			limiter.allow('trigger', 3);

			// A dropped key starts fresh; a retained one still carries its history.
			expect(limiter.allow('oldest', 4)).toBe(true);
			expect(limiter.size()).toBeLessThanOrEqual(3);
		});
	});
});
