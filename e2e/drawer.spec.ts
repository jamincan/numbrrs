import { test, expect } from '@playwright/test';
import { FIXTURE_TEAM } from './seed';

test('portrait: the drawer sits at the bottom, collapsed to the current options', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`/game/${FIXTURE_TEAM.league}/${FIXTURE_TEAM.code}`);

	await expect(page.getByText('show all', { exact: false })).toBeVisible();
	// Collapsed: grouped headings aren't rendered at all.
	await expect(page.getByText('Forwards')).toHaveCount(0);

	await page.getByText('show all', { exact: false }).click();
	await expect(page.getByText('Forwards')).toBeVisible();
});

test('landscape: the drawer is a full-height side panel, expanded by default', async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 500 });
	await page.goto(`/game/${FIXTURE_TEAM.league}/${FIXTURE_TEAM.code}`);

	await expect(page.getByText('hide roster', { exact: false })).toBeVisible();
	await expect(page.getByText('Forwards')).toBeVisible();
	// exact: HockeyCard's position label ("Defenseman") also contains "Defense".
	await expect(page.getByText('Defense', { exact: true })).toBeVisible();
	await expect(page.getByText('Goalies')).toBeVisible();
});
