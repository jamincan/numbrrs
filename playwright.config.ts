import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_PATH } from './e2e/seed';

// Deliberately not a port any tool here defaults to. 4173 is `vite preview`'s,
// and with reuseExistingServer a preview left running — on the real .env, with
// no fetch guard — would be taken for the test server and tested against.
const PORT = 4729;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	// CI also writes the HTML report, which the workflow uploads when the suite
	// fails; it carries the trace recorded on a failed test's retry (see `trace`).
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	// Runs against the production build, same as Fly does — dev mode's Vite
	// overlay and slower first-compile would make the timing-sensitive drawer
	// tests (ResizeObserver, media-query switching) unrepresentative.
	//
	// The preload refuses any fetch that would leave the machine, so the suite
	// cannot reach a league's API whatever state the fixture is in.
	webServer: {
		command: 'pnpm run build && node --import ./e2e/block-network.mjs build/index.js',
		// Playwright starts this server and waits for this URL *before* it runs
		// globalSetup, so the fixture is not seeded yet when it is polled. The
		// health endpoint only reads a table; the home page would find an empty
		// database and try to sync all five leagues.
		url: `http://localhost:${PORT}/api/health`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			DATABASE_URL: FIXTURE_PATH,
			ORIGIN: `http://localhost:${PORT}`,
			PORT: String(PORT),
			// Pinned for the same reason as ALERT_WEBHOOK_URL below: the shell's
			// own values must not leak in. ADMIN_DIRECT blank keeps the Cloudflare
			// Access check on, which e2e/admin.spec.ts relies on; the token only
			// has to exist, so /admin is configured rather than reporting it isn't.
			ADMIN_DIRECT: '',
			ADMIN_TOKEN: 'e2e-throwaway-admin-token-not-a-real-secret',
			// This runs as a plain `node build/index.js`, not through Vite, so
			// .env.test (Vite-only) doesn't reach it — the built server reads
			// $app/env/private straight from process.env, with no .env file
			// loading of its own. Blanked explicitly so this server can never
			// pick up a real ALERT_WEBHOOK_URL from whatever shell environment
			// happens to run this command, however that value got there.
			ALERT_WEBHOOK_URL: ''
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
