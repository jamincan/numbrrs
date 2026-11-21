import * as privateEnv from '$app/env/private';
import type { Cookies } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { isAuthenticated, startSession } from './lib/server/admin.ts';

/**
 * The other half of the canary in test-setup.test.ts: a test file that needs a
 * value in the environment can supply one, and what it supplies replaces the
 * global placeholder for everything that file imports. This is the pattern
 * test-setup.ts documents, kept here as a test so the documentation can't rot.
 */
vi.mock('$app/env/private', () => ({
	ALERT_WEBHOOK_URL: 'https://discord.test/api/webhooks/1/fake',
	ADMIN_TOKEN: 'a-token-that-exists-only-in-this-test-file',
	ADMIN_DIRECT: true,
	EDGE_TOKEN: undefined,
	DATABASE_URL: ':memory:'
}));

describe("a test file's own environment mock", () => {
	it('replaces the global placeholder', () => {
		expect(privateEnv.ALERT_WEBHOOK_URL).toBe('https://discord.test/api/webhooks/1/fake');
		expect(privateEnv.ADMIN_TOKEN).toBe('a-token-that-exists-only-in-this-test-file');
		expect(privateEnv.ADMIN_DIRECT).toBe(true);
	});

	it('is what the modules under test see', () => {
		// admin.ts reads ADMIN_TOKEN itself; a session only starts, and only
		// verifies, if it read the value above.
		const jar = new Map<string, string>();
		const cookies = {
			get: (name: string) => jar.get(name),
			set: (name: string, value: string) => void jar.set(name, value)
		} as unknown as Cookies;

		startSession(cookies, new URL('https://numbrrs.app/admin'));

		expect(jar.size).toBe(1);
		expect(isAuthenticated(cookies)).toBe(true);
	});

	it('does not lift the network guard', async () => {
		await expect(fetch(privateEnv.ALERT_WEBHOOK_URL ?? '')).rejects.toThrow(
			'A test tried to call the real fetch()'
		);
	});
});
