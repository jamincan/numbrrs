import { defineConfig, devices } from '@playwright/test';
import { FIXTURE_PATH } from './e2e/seed';

const PORT = 4173;

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	globalSetup: './e2e/global-setup.ts',
	use: {
		baseURL: `http://localhost:${PORT}`,
		trace: 'on-first-retry'
	},
	// Runs against the production build, same as Fly does — dev mode's Vite
	// overlay and slower first-compile would make the timing-sensitive drawer
	// tests (ResizeObserver, media-query switching) unrepresentative.
	webServer: {
		command: 'pnpm run build && node build/index.js',
		url: `http://localhost:${PORT}`,
		reuseExistingServer: !process.env.CI,
		timeout: 120_000,
		env: {
			DATABASE_URL: FIXTURE_PATH,
			ORIGIN: `http://localhost:${PORT}`,
			PORT: String(PORT)
		}
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
