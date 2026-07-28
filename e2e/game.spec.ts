import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_PLAYERS, FIXTURE_TEAM } from './seed';

const NUMBER_PATTERN = /^#\d+$/;

/** The number on the card currently being asked about — scoped to the draw
 *  pile (the first of the two card slots), and to the first match within it:
 *  HockeyCard renders both card faces at all times (the flip is a CSS
 *  transform, not conditional markup), so the front's number and the back's
 *  "#NN" under the player's name are both in the DOM simultaneously. */
async function drawnNumber(page: Page): Promise<number> {
	const text = await page
		.locator('.card-slot')
		.first()
		.getByText(NUMBER_PATTERN)
		.first()
		.innerText();
	return Number(text.slice(1));
}

function playerFor(sweaterNumber: number) {
	const player = FIXTURE_PLAYERS.find((p) => p.sweaterNumber === sweaterNumber);
	if (!player) throw new Error(`No fixture player wears #${sweaterNumber}`);
	return player;
}

function fullName(player: { firstName: string; lastName: string }): string {
	return `${player.firstName} ${player.lastName}`;
}

test.beforeEach(async ({ page }) => {
	await page.goto(`/game/${FIXTURE_TEAM.league}/${FIXTURE_TEAM.code}`);
	await expect(page.locator('.card-slot').first().getByText(NUMBER_PATTERN).first()).toBeVisible();
});

test('reaches a playable state with a card showing a number', async ({ page }) => {
	const number = await drawnNumber(page);
	expect(playerFor(number)).toBeTruthy();
	await expect(page.getByRole('button', { name: 'Difficulty' })).toBeVisible();
});

test('a correct guess marks the player identified', async ({ page }) => {
	// One fixture player has no sweater number, so they start pre-identified.
	await expect(page.getByText('1 / 11 identified')).toBeVisible();

	const player = playerFor(await drawnNumber(page));
	await page.getByRole('button', { name: fullName(player) }).click();

	const status = page.getByRole('status');
	await expect(status).toContainText('Correct');
	await expect(status).toContainText(fullName(player));
	await expect(page.getByText('2 / 11 identified')).toBeVisible();
});

test('an incorrect guess does not identify anyone', async ({ page }) => {
	// Expert shows every remaining player as an option, so any player other
	// than the drawn one is guaranteed to be clickable.
	await page.getByRole('button', { name: 'Difficulty' }).click();
	await page.getByRole('menuitemradio', { name: 'Expert' }).click();

	const correct = playerFor(await drawnNumber(page));
	const wrong = FIXTURE_PLAYERS.find(
		(p) => p.sweaterNumber !== null && p.sweaterNumber !== correct.sweaterNumber
	);
	if (!wrong) throw new Error('Fixture needs at least two numbered players');

	await expect(page.getByText('1 / 11 identified')).toBeVisible();
	await page.getByRole('button', { name: fullName(wrong) }).click();

	const status = page.getByRole('status');
	await expect(status).toContainText('Wrong');
	await expect(page.getByText('1 / 11 identified')).toBeVisible();
});

test('changing difficulty mid-game re-deals options without changing the drawn card', async ({
	page
}) => {
	const before = await drawnNumber(page);

	// Easy: the drawn player plus one other.
	const easyOptions = await page.getByRole('button').count();

	await page.getByRole('button', { name: 'Difficulty' }).click();
	await page.getByRole('menuitemradio', { name: 'Expert' }).click();

	await expect(async () => {
		expect(await page.getByRole('button').count()).toBeGreaterThan(easyOptions);
	}).toPass();

	expect(await drawnNumber(page)).toBe(before);
});
