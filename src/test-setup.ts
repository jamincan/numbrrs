import { afterEach, beforeEach, vi } from 'vitest';

/**
 * No test may reach the network by default. `ALERT_WEBHOOK_URL` (and anything
 * else read from a real `.env`) is a live secret in local dev, and a test that
 * exercises a failure path can trigger a real side effect — a Discord alert
 * fired for a synthetic "boom" error is exactly the incident this guards
 * against. A test that genuinely needs `fetch` has to mock it explicitly.
 */
beforeEach(() => {
	// A rejected promise, not a synchronous throw — real network failures always
	// surface as a rejection, and code written against that shape (fetch(...).then/.catch)
	// should see the same thing here.
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			Promise.reject(new Error('A test tried to call the real fetch(). Mock it explicitly.'))
		)
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
});
