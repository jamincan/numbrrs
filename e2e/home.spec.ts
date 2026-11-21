import { test, expect, type Page } from '@playwright/test';

// The fixture seeds teams for the NHL alone (see e2e/seed.ts) and marks every
// league's list as freshly synced, so any other league renders the "still
// syncing" placeholder rather than an error or a network call.
const SYNCING = 'Teams are still syncing from the league. Refresh in a moment.';

const LEAGUES = [
	['NHL', 'nhl'],
	['PWHL', 'pwhl'],
	['WHL', 'whl'],
	['OHL', 'ohl'],
	['QMJHL', 'qmjhl']
] as const;

function leagueNav(page: Page, name = 'League') {
	return page.getByRole('navigation', { name });
}

function leagueTab(page: Page, label: string) {
	return leagueNav(page).getByRole('link', { name: label, exact: true });
}

const toronto = (page: Page) => page.getByRole('link', { name: 'Toronto Maple Leafs' });

/** Path and query of where the page is now. */
function address(page: Page): string {
	const url = new URL(page.url());
	return url.pathname + url.search;
}

/**
 * Opens a page and waits for its script to have taken over. A tab is a working
 * link before that, so a click that lands early still shows the right league —
 * by following the link, which is not what these tests are about.
 */
async function openHydrated(page: Page, path: string) {
	await page.goto(path, { waitUntil: 'networkidle' });
}

test.describe('league tabs', () => {
	test('renders team tiles and lets the league tab choice persist across a reload', async ({
		page,
		context
	}) => {
		await openHydrated(page, '/');

		await expect(leagueNav(page)).toBeVisible();
		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');
		await expect(leagueTab(page, 'PWHL')).not.toHaveAttribute('aria-current');
		await expect(toronto(page)).toBeVisible();

		await leagueTab(page, 'PWHL').click();
		await expect(leagueTab(page, 'PWHL')).toHaveAttribute('aria-current', 'page');
		await expect(leagueTab(page, 'NHL')).not.toHaveAttribute('aria-current');
		await expect(page.getByText(SYNCING)).toBeVisible();
		await expect(toronto(page)).toHaveCount(0);

		// Swapped in place: the link was not followed, and the choice went to the
		// cookie, which is what the server reads on the next visit.
		expect(address(page)).toBe('/');
		const cookies = await context.cookies();
		expect(cookies.find((cookie) => cookie.name === 'numbrrs_league')?.value).toBe('pwhl');

		await page.reload();
		await expect(leagueTab(page, 'PWHL')).toHaveAttribute('aria-current', 'page');
		await expect(page.getByText(SYNCING)).toBeVisible();
	});

	test('a tab click takes over from a league named in the address', async ({ page }) => {
		await openHydrated(page, '/?league=pwhl');
		await expect(leagueTab(page, 'PWHL')).toHaveAttribute('aria-current', 'page');

		await leagueTab(page, 'NHL').click();
		await expect(toronto(page)).toBeVisible();

		// Left in the address, `?league=pwhl` would outrank the cookie and bring
		// the old tab back on the reload below.
		await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');

		await page.reload();
		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');
		await expect(toronto(page)).toBeVisible();
	});

	test('a league in the address is not a second canonical home page', async ({ page, request }) => {
		await page.goto('/?league=pwhl');

		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://numbrrs.app/'
		);
		for (const alternate of await page.locator('link[rel="alternate"]').all()) {
			await expect(alternate).not.toHaveAttribute('href', /league/);
		}

		const sitemap = await (await request.get('/sitemap.xml')).text();
		expect(sitemap).toContain('<loc>https://numbrrs.app/</loc>');
		expect(sitemap).not.toContain('league=');
	});

	test('the home page is kept out of shared caches while a league has no teams', async ({
		request
	}) => {
		// True of this fixture, which has teams for one league of five: a copy
		// stored now would go on showing the placeholder after the others arrive.
		for (const path of ['/', '/fr', '/?league=pwhl']) {
			const response = await request.get(path);
			expect(response.headers()['cache-control'], path).toBe('private, no-store');
		}
	});
});

test.describe('league tabs without JavaScript', () => {
	test.use({ javaScriptEnabled: false });

	test('every league is a link in the served HTML', async ({ page }) => {
		await page.goto('/');

		await expect(leagueNav(page).getByRole('link')).toHaveCount(LEAGUES.length);
		for (const [label, id] of LEAGUES) {
			await expect(leagueTab(page, label)).toHaveAttribute('href', new RegExp(`\\?league=${id}$`));
		}
		// Not tabs: there is no tabpanel for one to control.
		await expect(page.getByRole('tablist')).toHaveCount(0);
		await expect(page.getByRole('tab')).toHaveCount(0);

		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');
		await expect(toronto(page)).toBeVisible();
	});

	test('a league link is answered by the server', async ({ page, context }) => {
		await page.goto('/');

		await leagueTab(page, 'PWHL').click();
		await expect(page).toHaveURL(/\/\?league=pwhl$/);
		await expect(leagueTab(page, 'PWHL')).toHaveAttribute('aria-current', 'page');
		await expect(leagueTab(page, 'NHL')).not.toHaveAttribute('aria-current');
		await expect(page.getByText(SYNCING)).toBeVisible();
		await expect(toronto(page)).toHaveCount(0);

		await leagueTab(page, 'NHL').click();
		await expect(page).toHaveURL(/\/\?league=nhl$/);
		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');
		await expect(toronto(page)).toBeVisible();

		// Nothing was remembered: the server sets no cookie, since a response that
		// did could not be shared.
		expect(await context.cookies()).toEqual([]);
	});

	test('the address decides the league, then the cookie, then the default', async ({
		page,
		context
	}) => {
		await page.goto('/');
		await context.addCookies([{ name: 'numbrrs_league', value: 'pwhl', url: page.url() }]);

		await page.goto('/');
		await expect(leagueTab(page, 'PWHL')).toHaveAttribute('aria-current', 'page');
		await expect(page.getByText(SYNCING)).toBeVisible();

		await page.goto('/?league=nhl');
		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');
		await expect(toronto(page)).toBeVisible();

		// A league that does not exist is passed over, not refused.
		await page.goto('/?league=nonsense');
		await expect(leagueTab(page, 'PWHL')).toHaveAttribute('aria-current', 'page');

		await context.clearCookies();
		await page.goto('/?league=nonsense');
		await expect(leagueTab(page, 'NHL')).toHaveAttribute('aria-current', 'page');
		await expect(toronto(page)).toBeVisible();
	});

	test('the French home page has the same links under /fr', async ({ page }) => {
		await page.goto('/fr?league=pwhl');

		const nav = leagueNav(page, 'Ligue');
		await expect(nav.getByRole('link', { name: 'LPHF', exact: true })).toHaveAttribute(
			'aria-current',
			'page'
		);

		await nav.getByRole('link', { name: 'LNH', exact: true }).click();
		await expect(page).toHaveURL(/\/fr\?league=nhl$/);
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
		await expect(page.getByRole('link', { name: 'Maple Leafs de Toronto' })).toBeVisible();
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
			'href',
			'https://numbrrs.app/fr'
		);
	});
});
