import { test, expect } from '@playwright/test';

test('renders team tiles and lets the league tab choice persist across a reload', async ({
	page
}) => {
	await page.goto('/');

	await expect(page.getByRole('tablist', { name: 'League' })).toBeVisible();
	const nhlTab = page.getByRole('tab', { name: 'NHL' });
	await expect(nhlTab).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByRole('link', { name: 'Toronto Maple Leafs' })).toBeVisible();

	// Switch to a league with no seeded teams. The fixture marks its team list
	// as freshly synced (see e2e/seed.ts), so this renders the "still syncing"
	// placeholder rather than an error or a network call.
	await page.getByRole('tab', { name: 'PWHL' }).click();
	await expect(page.getByRole('tab', { name: 'PWHL' })).toHaveAttribute('aria-selected', 'true');

	await page.reload();
	await expect(page.getByRole('tab', { name: 'PWHL' })).toHaveAttribute('aria-selected', 'true');
});
