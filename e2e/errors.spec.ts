import { test, expect } from '@playwright/test';

test('a bogus team code renders the error page in English', async ({ page }) => {
	const response = await page.goto('/game/nhl/ZZZ');
	expect(response?.status()).toBe(404);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Back to the teams' })).toBeVisible();
});

test('a bogus team code renders the error page in French', async ({ page }) => {
	const response = await page.goto('/fr/game/nhl/ZZZ');
	expect(response?.status()).toBe(404);
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await expect(page.getByRole('heading', { name: 'Page introuvable' })).toBeVisible();
});
