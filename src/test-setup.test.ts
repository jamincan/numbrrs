import * as privateEnv from '$app/env/private';
import type { Cookies } from '@sveltejs/kit';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { variables } from './env.ts';
import { isAuthenticated, startSession } from './lib/server/admin.ts';

/**
 * A canary for the guards in test-setup.ts. If either stops holding, a test
 * elsewhere that exercises a failure path can reach the developer's real
 * webhook, database or admin token — so these are checked directly rather than
 * trusted to keep working.
 */

// Captured while this file is being imported, before any hook has run.
const fetchAtImport = globalThis.fetch;

const NETWORK_BLOCKED = 'A test tried to call the real fetch(). Mock it explicitly.';

describe('test environment', () => {
	it('sees placeholder values, not the developer environment', () => {
		expect(privateEnv.ALERT_WEBHOOK_URL).toBeUndefined();
		expect(privateEnv.ADMIN_TOKEN).toBeUndefined();
		expect(privateEnv.ADMIN_DIRECT).toBe(false);
		expect(privateEnv.DATABASE_URL).toBe(':memory:');
	});

	it('replaces every variable src/env.ts declares', () => {
		// A variable missing from the mock would not leak — reading it throws —
		// but it would throw from whichever test first touched it. This names
		// the omission instead.
		expect(Object.keys(privateEnv).sort()).toEqual(Object.keys(variables).sort());
	});

	it('reaches the modules that read the environment, not only this file', () => {
		// admin.ts imports ADMIN_TOKEN for itself. With the real environment it
		// would hold whatever the developer's .env does and start a session.
		const set = vi.fn();
		const cookies = { get: () => undefined, set } as unknown as Cookies;

		startSession(cookies, new URL('https://numbrrs.app/admin'));

		expect(set).not.toHaveBeenCalled();
		expect(isAuthenticated(cookies)).toBe(false);
	});

	it('has none of the declared variables in process.env either', () => {
		for (const name of Object.keys(variables)) {
			expect(process.env[name], name).toBeUndefined();
		}
	});
});

describe('network guard', () => {
	it('is in place while a test file is being imported', async () => {
		expect(vi.isMockFunction(fetchAtImport)).toBe(true);
		await expect(fetchAtImport('https://example.invalid/')).rejects.toThrow(NETWORK_BLOCKED);
	});

	it('is in place inside a test', async () => {
		expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
		await expect(fetch('https://example.invalid/')).rejects.toThrow(NETWORK_BLOCKED);
	});

	it("is back in place after a test that swapped in its own fetch (this test's half)", () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => Promise.resolve(new Response('stubbed by the test')))
		);
		expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
	});

	it('is back in place after a test that swapped in its own fetch', async () => {
		await expect(fetch('https://example.invalid/')).rejects.toThrow(NETWORK_BLOCKED);
	});

	afterAll(async () => {
		// After the last test's cleanup, when a request started by a test but not
		// awaited would land. Unstubbing must not have left the real fetch behind.
		expect(vi.isMockFunction(globalThis.fetch)).toBe(true);
		await expect(fetch('https://example.invalid/')).rejects.toThrow(NETWORK_BLOCKED);
	});
});
