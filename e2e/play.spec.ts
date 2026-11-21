import { test, expect, type Page } from '@playwright/test';
import { SHORT_PLAYERS, SHORT_TEAM } from './seed';

const NUMBER_PATTERN = /^#\d+$/;
const GAME_PATH = `/game/${SHORT_TEAM.league}/${SHORT_TEAM.code}`;

/** The front of the card in the draw pile — the first of the two card slots.
 *  Once it is on screen the page has hydrated: the game only renders after the
 *  roster has streamed in. */
function drawnCard(page: Page) {
	return page.locator('.card-slot').first().getByText(NUMBER_PATTERN).first();
}

async function drawnNumber(page: Page): Promise<number> {
	return Number((await drawnCard(page).innerText()).slice(1));
}

function fullName(player: { firstName: string; lastName: string }): string {
	return `${player.firstName} ${player.lastName}`;
}

function wearers(sweaterNumber: number): string[] {
	return SHORT_PLAYERS.filter((p) => p.sweaterNumber === sweaterNumber).map(fullName);
}

/** The answers on offer for the card that's up, by whether they would be right.
 *  Only a player who can be picked is a button, in either drawer layout. */
async function choices(page: Page) {
	const sweaterNumber = await drawnNumber(page);
	const right: string[] = [];
	const wrong: string[] = [];
	for (const player of SHORT_PLAYERS) {
		const name = fullName(player);
		if ((await page.getByRole('button', { name, exact: true }).count()) === 0) continue;
		(player.sweaterNumber === sweaterNumber ? right : wrong).push(name);
	}
	return { sweaterNumber, right, wrong };
}

/** Tab to the named answer and press it: the keyboard, and nothing else. */
async function pressAnswer(page: Page, name: string) {
	const answer = page.getByRole('button', { name, exact: true });
	for (let presses = 0; presses < 40; presses++) {
		if (await answer.evaluate((el) => el === document.activeElement)) {
			await page.keyboard.press('Enter');
			return;
		}
		await page.keyboard.press('Tab');
	}
	throw new Error(`Tab never reached the answer "${name}"`);
}

/** One reading, not a retrying assertion: the point is that focus is not on
 *  <body> even for a moment once the key press has been handled. */
function focusedTag(page: Page): Promise<string | undefined> {
	return page.evaluate(() => document.activeElement?.tagName);
}

for (const layout of [
	{ name: 'bottom drawer, collapsed', viewport: { width: 390, height: 844 } },
	{ name: 'side panel, expanded', viewport: { width: 1280, height: 720 } }
]) {
	test(`keyboard only: a roster played to the end, then again (${layout.name})`, async ({
		page
	}) => {
		await page.setViewportSize(layout.viewport);
		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		await expect(page.getByText('0 / 6 identified')).toBeVisible();

		// Arriving doesn't take focus; only a guess moves it.
		expect(await focusedTag(page)).toBe('BODY');

		const status = page.getByRole('status');
		const answers = page.getByRole('group', { name: 'Answer choices' });
		const playAgain = page.getByRole('button', { name: 'Play Again' });
		await expect(status).toBeEmpty();

		let guesses = 0;
		let missed = false;
		let lastRight = '';
		while ((await playAgain.count()) === 0) {
			// Six right answers and one miss; anything past that is a game that
			// isn't going to end.
			expect(guesses).toBeLessThan(8);

			const { sweaterNumber, right, wrong } = await choices(page);
			// Miss once, on a number only one player wears: the card then turns over
			// as that player, so the announcement can be checked word for word.
			const miss = !missed && wrong.length > 0 && wearers(sweaterNumber).length === 1;
			const pick = miss ? wrong[0] : right[0];
			if (!pick) throw new Error(`No answer to give for #${sweaterNumber}`);

			await pressAnswer(page, pick);
			guesses += 1;
			expect(await focusedTag(page)).not.toBe('BODY');

			const verdict = miss
				? `Wrong — #${sweaterNumber} is ${wearers(sweaterNumber)[0]}.`
				: `Correct — #${sweaterNumber} is ${pick}.`;
			if (miss) missed = true;
			else lastRight = verdict;

			if ((await playAgain.count()) === 0) {
				await expect(status).toHaveText(`${verdict} Next: #${await drawnNumber(page)}.`);
				await expect(answers).toBeFocused();
			}
		}

		expect(missed).toBe(true);
		expect(guesses).toBe(7);

		// Six of seven guesses were right.
		const summary = page.getByRole('group', { name: 'Congratulations!' });
		await expect(summary).toBeFocused();
		await expect(summary).toContainText('Accuracy: 86%');
		await expect(status).toHaveText(
			`${lastRight} You identified every player on this team! Accuracy: 86%`
		);
		await expect(page.getByText('6 / 6 identified')).toBeVisible();

		await page.keyboard.press('Tab');
		await expect(playAgain).toBeFocused();
		await page.keyboard.press('Enter');

		expect(await focusedTag(page)).not.toBe('BODY');
		await expect(answers).toBeFocused();
		await expect(playAgain).toHaveCount(0);
		await expect(drawnCard(page)).toBeVisible();
		await expect(page.getByText('0 / 6 identified')).toBeVisible();
		await expect(status).toBeEmpty();
	});
}

test('two players on one number are each a right answer for it', async ({ page }) => {
	await page.goto(GAME_PATH);
	await expect(drawnCard(page)).toBeVisible();

	// Expert offers everyone still unidentified, so both wearers are on offer
	// whichever of them the card was dealt for.
	await page.getByRole('button', { name: 'Difficulty' }).click();
	await page.getByRole('menuitemradio', { name: 'Expert' }).click();

	const status = page.getByRole('status');

	/** Answer whatever comes up, correctly, until the shared number does. */
	async function playUntilShared() {
		for (let turn = 0; (await drawnNumber(page)) !== 11; turn++) {
			expect(turn).toBeLessThan(6);
			const { sweaterNumber, right } = await choices(page);
			const pick = right[0];
			if (!pick) throw new Error(`No answer to give for #${sweaterNumber}`);
			await page.getByRole('button', { name: pick, exact: true }).click();
			await expect(status).toContainText(`Correct — #${sweaterNumber} is ${pick}.`);
		}
	}

	const [first, second] = wearers(11);
	if (!first || !second) throw new Error('The fixture needs two players wearing #11');

	// The card was dealt for one of the two, and the test can't tell which — but
	// whichever is picked, it turns over as that player, and the other one's
	// card is still to come.
	await playUntilShared();
	await expect(page.getByRole('button', { name: first, exact: true })).toBeVisible();
	await page.getByRole('button', { name: second, exact: true }).click();
	await expect(status).toContainText(`Correct — #11 is ${second}.`);

	await playUntilShared();
	await expect(page.getByRole('button', { name: second, exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: first, exact: true }).click();
	await expect(status).toContainText(`Correct — #11 is ${first}.`);
});

test('a guess is announced in French', async ({ page }) => {
	await page.goto(`/fr${GAME_PATH}`);
	await expect(drawnCard(page)).toBeVisible();

	const { sweaterNumber, right } = await choices(page);
	await page.getByRole('button', { name: right[0], exact: true }).click();

	await expect(page.getByRole('status')).toContainText(
		`Exact — le numéro ${sweaterNumber}, c’est ${right[0]}.`
	);
	await expect(page.getByRole('group', { name: 'Choix de réponse' })).toBeFocused();
});
