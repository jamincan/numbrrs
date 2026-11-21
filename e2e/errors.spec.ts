import { test, expect } from '@playwright/test';

test('a bogus team code renders the error page in English', async ({ page }) => {
	const response = await page.goto('/game/nhl/ZZZ');
	expect(response?.status()).toBe(404);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(page.getByText('Team not found', { exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Back to the teams' })).toBeVisible();
});

test('a bogus team code renders the error page in French', async ({ page }) => {
	const response = await page.goto('/fr/game/nhl/ZZZ');
	expect(response?.status()).toBe(404);
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
	// The line under the title says which part of the address was wrong, and
	// says it in the page's language rather than as the load function threw it.
	await expect(page.getByText('Équipe introuvable', { exact: true })).toBeVisible();
	await expect(page.getByText('Team not found')).toHaveCount(0);
});

test('a bogus league code is named as such, in French on a French page', async ({ page }) => {
	const response = await page.goto('/fr/game/zzz/TOR');
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
	await expect(page.getByText('Ligue introuvable', { exact: true })).toBeVisible();
	await expect(page.getByText('League not found')).toHaveCount(0);
});
