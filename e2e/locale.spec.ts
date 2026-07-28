import { test, expect } from '@playwright/test';

test('the locale toggle navigates to /fr and back, and <html lang> follows', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	await page.getByRole('link', { name: 'fr', exact: true }).click();
	await expect(page).toHaveURL(/\/fr\/?$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

	await page.getByRole('link', { name: 'en', exact: true }).click();
	await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});
