import { test, expect, type Page } from '@playwright/test';
import { SHORT_PLAYERS, SHORT_TEAM } from './seed';

const NUMBER_PATTERN = /^#\d+$/;
const GAME_PATH = `/game/${SHORT_TEAM.league}/${SHORT_TEAM.code}`;

/** The progress bar, when what it says starts with this: the count of players
 *  left, which is said and not shown. */
const progressSays = (page: Page, text: string) =>
	page.locator(`[role="progressbar"][aria-valuetext^="${text}"]`);

/** The front of the card in the draw pile — the first of the two card slots.
 *  Once it is on screen the page has hydrated: the server's markup holds an
 *  undealt deck, and the first card is only turned up by the browser. */
function drawnCard(page: Page) {
	return page.locator('.card-slot').first().getByText(NUMBER_PATTERN).first();
}

async function drawnNumber(page: Page): Promise<number> {
	return Number((await drawnCard(page).innerText()).slice(1));
}

function fullName(player: { firstName: string; lastName: string }): string {
	return `${player.firstName} ${player.lastName}`;
}

function numberOf(name: string): number {
	const player = SHORT_PLAYERS.find((p) => fullName(p) === name);
	if (!player) throw new Error(`No fixture player is called ${name}`);
	return player.sweaterNumber;
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

// A first visit starts on Learn, which has rules of its own (e2e/learn.spec.ts).
// Everything here is about the plain run of question cards, so it is played at
// a quiz level: set as an earlier visit would have left it.
test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('numbrrs_difficulty', 'easy'));
});

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
		await expect(progressSays(page, '6 left')).toBeVisible();

		// Arriving doesn't take focus; only a guess moves it.
		expect(await focusedTag(page)).toBe('BODY');

		const status = page.getByRole('status');
		const answers = page.getByRole('group', { name: 'Answer choices' });
		const playAgain = page.getByRole('button', { name: 'Play Again' });
		await expect(status).toBeEmpty();

		let guesses = 0;
		/** Whoever's card was answered wrongly, once one has been. */
		let missed = '';
		let lastRight = '';
		while ((await playAgain.count()) === 0) {
			// Six right answers and one miss; anything past that is a game that
			// isn't going to end.
			expect(guesses).toBeLessThan(8);

			const { sweaterNumber, right, wrong } = await choices(page);
			// Miss once, on a number only one player wears: the card then turns over
			// as that player, so the announcement can be checked word for word.
			const miss = missed === '' && wrong.length > 0 && wearers(sweaterNumber).length === 1;
			const pick = miss ? wrong[0] : right[0];
			if (!pick) throw new Error(`No answer to give for #${sweaterNumber}`);

			await pressAnswer(page, pick);
			guesses += 1;
			expect(await focusedTag(page)).not.toBe('BODY');

			// A miss is read out with the number of whoever was picked instead.
			const verdict = miss
				? `Wrong — #${sweaterNumber} is ${wearers(sweaterNumber)[0]}. ${pick} wears #${numberOf(pick)}.`
				: `Correct — #${sweaterNumber} is ${pick}.`;
			if (miss) missed = wearers(sweaterNumber)[0] ?? '';
			else lastRight = verdict;

			if ((await playAgain.count()) === 0) {
				await expect(status).toHaveText(`${verdict} Next: #${await drawnNumber(page)}.`);
				await expect(answers).toBeFocused();
			}
		}

		expect(missed).not.toBe('');
		// The missed card came round again, so six players took seven guesses.
		expect(guesses).toBe(7);

		// Five of the six were found on the first try.
		const summary = page.getByRole('group', { name: 'Congratulations!' });
		await expect(summary).toBeFocused();
		await expect(summary).toContainText('First try: 5 / 6');
		await expect(status).toHaveText(
			`${lastRight} You identified every player on this team! First try: 5 / 6`
		);
		// The one that wasn't is listed to be looked at again, with the number.
		await expect(page.getByRole('heading', { name: 'Missed on the first try' })).toBeVisible();
		const review = page.getByRole('listitem').filter({ hasText: missed });
		await expect(review).toHaveCount(1);
		await expect(review).toContainText(String(numberOf(missed)));

		await page.keyboard.press('Tab');
		await expect(playAgain).toBeFocused();
		await page.keyboard.press('Enter');

		expect(await focusedTag(page)).not.toBe('BODY');
		await expect(answers).toBeFocused();
		await expect(playAgain).toHaveCount(0);
		await expect(drawnCard(page)).toBeVisible();
		await expect(progressSays(page, '6 left')).toBeVisible();
		await expect(status).toBeEmpty();
	});
}

test('two players on one number are each a right answer for it', async ({ page }) => {
	await page.goto(GAME_PATH);
	await expect(drawnCard(page)).toBeVisible();

	// Hard offers everyone with a number on every card, so both wearers are on
	// offer whichever of them the card was dealt for.
	await page.getByRole('button', { name: 'Level' }).click();
	await page.getByRole('menuitemradio', { name: 'Hard' }).click();

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

	// A quiz level goes on offering a player who has been found, and for this
	// number they are still a right answer. Picking them again can't find them
	// twice, so it is the other wearer who is found: the game ends with all six.
	await playUntilShared();
	await expect(page.getByRole('button', { name: first, exact: true })).toBeVisible();
	await page.getByRole('button', { name: second, exact: true }).click();
	await expect(status).toContainText(`Correct — #11 is ${second}.`);

	const playAgain = page.getByRole('button', { name: 'Play Again' });
	for (let turn = 0; (await playAgain.count()) === 0; turn++) {
		expect(turn).toBeLessThan(6);
		const { sweaterNumber, right } = await choices(page);
		const pick = right[0];
		if (!pick) throw new Error(`No answer to give for #${sweaterNumber}`);
		await page.getByRole('button', { name: pick, exact: true }).click();
		await expect(status).toContainText(`Correct — #${sweaterNumber} is ${pick}.`);
	}
	const summary = page.getByRole('group', { name: 'Congratulations!' });
	await expect(summary).toContainText('First try: 6 / 6');
	await expect(summary).toContainText('Perfect run: gold medal');
});

test.describe('a game in progress, kept for the tab', () => {
	const SAVED_GAME = `numbrrs_game:${SHORT_TEAM.league}:${SHORT_TEAM.code}`;
	const savedGame = (page: Page) => page.evaluate((key) => sessionStorage.getItem(key), SAVED_GAME);

	/** Everyone on offer for the card that's up, in a stable order. */
	async function offered(page: Page): Promise<string[]> {
		const { right, wrong } = await choices(page);
		return [...right, ...wrong].sort();
	}

	/** One right answer, then one miss where the card allows it — so the saved
	 *  game has a missed card back in the pile as well as a player found. */
	async function playTwoCards(page: Page) {
		const first = await choices(page);
		const found = first.right[0];
		if (!found) throw new Error(`No answer to give for #${first.sweaterNumber}`);
		await page.getByRole('button', { name: found, exact: true }).click();
		await expect(progressSays(page, '5 left')).toBeVisible();

		const second = await choices(page);
		// Easy offers five of the six, and at most two of them wear the number.
		if (second.wrong[0]) {
			await page.getByRole('button', { name: second.wrong[0], exact: true }).click();
			await expect(page.getByRole('status')).toContainText('Wrong');
		}
	}

	test.beforeEach(async ({ page }) => {
		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		await expect(progressSays(page, '6 left')).toBeVisible();
	});

	test('nothing is stored until a guess is made', async ({ page }) => {
		expect(await savedGame(page)).toBeNull();
	});

	test('a reload picks the game back up, on the same card, without announcing anything', async ({
		page
	}) => {
		await playTwoCards(page);
		const sweaterNumber = await drawnNumber(page);
		const answers = await offered(page);
		const stored = await savedGame(page);
		expect(stored).not.toBeNull();

		await page.reload();
		await expect(drawnCard(page)).toBeVisible();

		await expect(progressSays(page, '5 left')).toBeVisible();
		expect(await drawnNumber(page)).toBe(sweaterNumber);
		expect(await offered(page)).toEqual(answers);
		// The last guess is not replayed: nothing on the pile, nothing read out,
		// and focus left where a fresh arrival leaves it.
		await expect(page.getByRole('status')).toBeEmpty();
		await expect(page.locator('.card-slot').nth(1).getByText(NUMBER_PATTERN)).toHaveCount(0);
		expect(await focusedTag(page)).toBe('BODY');
		expect(await savedGame(page)).toBe(stored);
	});

	test('switching language keeps the game', async ({ page }) => {
		await playTwoCards(page);
		const sweaterNumber = await drawnNumber(page);
		const answers = await offered(page);

		// A full page load to the same team's French URL.
		await page.getByRole('link', { name: 'fr', exact: true }).click();
		await expect(page).toHaveURL(`/fr${GAME_PATH}`);
		await expect(drawnCard(page)).toBeVisible();

		await expect(progressSays(page, '5 à trouver')).toBeVisible();
		expect(await drawnNumber(page)).toBe(sweaterNumber);
		expect(await offered(page)).toEqual(answers);
		await expect(page.getByRole('status')).toBeEmpty();
	});

	test('a finished game comes back finished, and Play Again clears it', async ({ page }) => {
		const playAgain = page.getByRole('button', { name: 'Play Again' });
		for (let guesses = 0; (await playAgain.count()) === 0; guesses++) {
			expect(guesses).toBeLessThan(6);
			const { sweaterNumber, right } = await choices(page);
			const pick = right[0];
			if (!pick) throw new Error(`No answer to give for #${sweaterNumber}`);
			await page.getByRole('button', { name: pick, exact: true }).click();
			await expect(page.getByRole('status')).toContainText(
				`Correct — #${sweaterNumber} is ${pick}.`
			);
		}

		await page.reload();

		const summary = page.getByRole('group', { name: 'Congratulations!' });
		await expect(summary).toBeVisible();
		await expect(summary).toContainText('First try: 6 / 6');
		await expect(page.getByRole('status')).toBeEmpty();

		await playAgain.click();
		await expect(drawnCard(page)).toBeVisible();
		await expect(progressSays(page, '6 left')).toBeVisible();
		expect(await savedGame(page)).toBeNull();

		await page.reload();
		await expect(drawnCard(page)).toBeVisible();
		await expect(progressSays(page, '6 left')).toBeVisible();
		await expect(playAgain).toHaveCount(0);
	});

	test('a saved game that no longer fits is dropped, and a fresh one dealt', async ({ page }) => {
		await playTwoCards(page);

		// As after a roster change: the saved piles name someone who has left.
		await page.evaluate((key) => {
			const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') as { roster: string };
			sessionStorage.setItem(key, JSON.stringify({ ...saved, roster: `999:99,${saved.roster}` }));
		}, SAVED_GAME);
		await page.reload();
		await expect(drawnCard(page)).toBeVisible();
		await expect(progressSays(page, '6 left')).toBeVisible();
		expect(await savedGame(page)).toBeNull();

		await page.evaluate((key) => sessionStorage.setItem(key, '{"v":1,'), SAVED_GAME);
		await page.reload();
		await expect(drawnCard(page)).toBeVisible();
		await expect(progressSays(page, '6 left')).toBeVisible();
		expect(await savedGame(page)).toBeNull();
	});
});

test.describe('the page as served, before any script runs', () => {
	test.use({ javaScriptEnabled: false });

	test('names the whole roster, and gives away nothing about the cards', async ({
		page,
		request
	}) => {
		// The response itself, as a crawler reads it. Scripts are set aside first:
		// the page's data is in one, so the names would be found there whether or
		// not they are in the markup.
		const html = await (await request.get(GAME_PATH)).text();
		const markup = html.replace(/<script[\s\S]*?<\/script>/g, '');
		for (const player of SHORT_PLAYERS) expect(markup).toContain(player.lastName);

		await page.goto(GAME_PATH);
		for (const player of SHORT_PLAYERS) {
			await expect(page.locator('li').filter({ hasText: fullName(player) })).toHaveCount(1);
		}
		await expect(progressSays(page, '6 left')).toBeVisible();

		// The deck is face down and nobody's number is on the page: which card
		// comes up first is decided in each visitor's browser, not here.
		await expect(page.getByText(NUMBER_PATTERN)).toHaveCount(0);
		await expect(page.getByText('Who wears this number?')).toHaveCount(0);
		await expect(page.getByRole('button', { name: fullName(SHORT_PLAYERS[0]) })).toHaveCount(0);

		// Text matching skips <noscript>, so the note is found by where it is.
		await expect(page.locator('noscript p')).toBeVisible();
	});
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
