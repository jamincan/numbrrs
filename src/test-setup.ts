import { afterEach, beforeEach, vi } from 'vitest';

/**
 * Two guards, each of which would have been enough on its own to stop the
 * incident they exist for: a test exercising a failure path posted a synthetic
 * "boom" error to the real Discord webhook, because the developer's `.env` was
 * visible to the test run.
 *
 * 1. No test sees the developer's environment.
 *
 * SvelteKit builds `$app/env/private` from Vite's `loadEnv`, which reads `.env`
 * and the shell alike, and the shell wins over `.env.test` — so a file of blank
 * values cannot be relied on to blank anything. Replacing the module outright
 * is the only version of this that does not depend on what happens to be
 * exported in the terminal the tests were started from.
 *
 * Every variable declared in src/env.ts has to appear here (the `satisfies`
 * below and the canary in test-setup.test.ts both check), and each is what the
 * app sees when the variable is unset — except the database, which is pointed
 * at memory so nothing can open a real file.
 *
 * A test that needs a value declares its own mock, which replaces this one for
 * that file. Everything the file imports sees it, however deep:
 *
 *     vi.mock('$app/env/private', () => ({
 *         ALERT_WEBHOOK_URL: 'https://discord.test/api/webhooks/1/fake',
 *         ADMIN_TOKEN: undefined,
 *         ADMIN_DIRECT: false,
 *         EDGE_TOKEN: undefined,
 *         DATABASE_URL: ':memory:'
 *     }));
 *
 * List all five: a mock is the whole module, and reading an export it lacks is
 * an error rather than a fall-through to this one. To change a value between
 * tests, have the factory return getters over a `vi.hoisted` object (see
 * hooks.server.test.ts). Never reach for `vi.importActual` on this module —
 * that is the one way to get the real values back. A test using a webhook URL
 * also has to supply its own `fetch`, or guard 2 rejects the call.
 */
vi.mock(
	'$app/env/private',
	() =>
		({
			ALERT_WEBHOOK_URL: undefined,
			ADMIN_TOKEN: undefined,
			ADMIN_DIRECT: false,
			EDGE_TOKEN: undefined,
			DATABASE_URL: ':memory:'
		}) satisfies typeof import('$app/env/private')
);

// Nothing in src/ reads these from process.env, and this keeps it that way from
// mattering: a value exported in the shell is gone before any test can look.
for (const name of [
	'ALERT_WEBHOOK_URL',
	'ADMIN_TOKEN',
	'ADMIN_DIRECT',
	'EDGE_TOKEN',
	'DATABASE_URL'
]) {
	delete process.env[name];
}

/**
 * 2. No test reaches the network by default. A test that genuinely needs
 * `fetch` has to mock it explicitly.
 */
function blockNetwork(): void {
	// A rejected promise, not a synchronous throw — real network failures always
	// surface as a rejection, and code written against that shape (fetch(...).then/.catch)
	// should see the same thing here.
	vi.stubGlobal(
		'fetch',
		vi.fn(() =>
			Promise.reject(new Error('A test tried to call the real fetch(). Mock it explicitly.'))
		)
	);
}

// Once now, so that code running while a test file is being imported — before
// any hook has had a chance to fire — is covered too.
blockNetwork();

beforeEach(blockNetwork);

afterEach(() => {
	vi.unstubAllGlobals();
	// Unstubbing puts the real fetch back, and work a test started but didn't
	// wait for (a fire-and-forget alert, say) can still be running after it ends.
	blockNetwork();
});
