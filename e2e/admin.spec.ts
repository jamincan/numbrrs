import { test, expect } from '@playwright/test';

/**
 * The built server, started the way production is (no ADMIN_DIRECT, see
 * playwright.config.ts), must refuse /admin to a request that carries no
 * Cloudflare Access token. Unit tests cover the check itself; this covers the
 * part only a real server has, which is whether a request reaches the check at
 * all.
 *
 * Sent with Playwright's request client rather than a page, so the path goes
 * out exactly as written and nothing follows a redirect on the test's behalf.
 */
test.describe('/admin without a Cloudflare Access token', () => {
	test('refuses a GET', async ({ request }) => {
		const response = await request.get('/admin', { maxRedirects: 0 });
		expect(response.status()).toBe(403);
	});

	// SvelteKit decodes the path before routing, so this reaches the admin route
	// just as /admin does. A check that compares the raw path lets it through.
	test('refuses a GET to a percent-encoded spelling of the path', async ({ request }) => {
		const response = await request.get('/%61dmin', { maxRedirects: 0 });
		expect(new URL(response.url()).pathname).toBe('/%61dmin');
		expect(response.status()).toBe(403);
	});

	test('refuses a login POST', async ({ request, baseURL }) => {
		expect(baseURL).toBeTruthy();
		const response = await request.post('/admin?/login', {
			maxRedirects: 0,
			// SvelteKit turns away a form POST whose Origin is missing or foreign
			// with a 403 of its own, before any hook runs. Sending the server's own
			// origin gets past that, so the 403 asserted below is the Access check's.
			headers: { origin: baseURL! },
			form: { token: 'not-the-token' }
		});
		expect(response.status()).toBe(403);
		expect(await response.text()).not.toContain('Cross-site');
	});
});
