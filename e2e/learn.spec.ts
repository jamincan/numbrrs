import { test, expect, type Page } from '@playwright/test';
import { SHORT_PLAYERS, SHORT_TEAM } from './seed';

/** The progress bar, when what it says starts with this: the count of players
 *  left, which is said and not shown. */
const progressSays = (page: Page, text: string) =>
	page.locator(`[role="progressbar"][aria-valuetext^="${text}"]`);
/** And when it says this anywhere: what has become of the medal. */
const progressMentions = (page: Page, text: string) =>
	page.locator(`[role="progressbar"][aria-valuetext*="${text}"]`);

// Learn, the level a first visit starts on: players dealt face up a batch at a
// time, asked about soon after, and then a final lap with the roster's numbers
// hidden. The short roster is six players, so one batch of five and one of one.

const GAME_PATH = `/game/${SHORT_TEAM.league}/${SHORT_TEAM.code}`;
const SAVED_GAME = `numbrrs_game:${SHORT_TEAM.league}:${SHORT_TEAM.code}`;
const NUMBER_PATTERN = /^#\d+$/;

type FixturePlayer = (typeof SHORT_PLAYERS)[number];

function fullName(player: { firstName: string; lastName: string }): string {
	return `${player.firstName} ${player.lastName}`;
}

/** The card in the draw pile, whichever way up it is. */
const deckSlot = (page: Page) => page.locator('.card-slot').first();
const nextButton = (page: Page) => page.getByRole('button', { name: 'Next', exact: true });
const playAgain = (page: Page) => page.getByRole('button', { name: 'Play Again' });
const answers = (page: Page) =>
	page.getByRole('group', { name: 'Answer choices' }).getByRole('button');

async function drawnNumber(page: Page): Promise<number> {
	return Number((await deckSlot(page).getByText(NUMBER_PATTERN).first().innerText()).slice(1));
}

/** A player's entry in the roster, shown in full at the default viewport. */
function rosterEntry(page: Page, player: FixturePlayer) {
	return page.locator('li').filter({ hasText: fullName(player) });
}

/**
 * Deal with the card that's up as someone who knows the roster would: move on
 * from an introduction, or answer a question rightly. Returns who was named,
 * or null for an introduction.
 */
async function advance(page: Page): Promise<FixturePlayer | null> {
	if ((await nextButton(page).count()) > 0) {
		await nextButton(page).click();
		return null;
	}
	const sweaterNumber = await drawnNumber(page);
	for (const player of SHORT_PLAYERS) {
		if (player.sweaterNumber !== sweaterNumber) continue;
		const button = page.getByRole('button', { name: fullName(player), exact: true });
		if ((await button.count()) === 0) continue;
		await button.click();
		await expect(page.getByRole('status')).toContainText(
			`Correct — #${sweaterNumber} is ${fullName(player)}.`
		);
		return player;
	}
	throw new Error(`No right answer on offer for #${sweaterNumber}`);
}

test.beforeEach(async ({ page }) => {
	await page.goto(GAME_PATH);
	await expect(deckSlot(page).getByText(NUMBER_PATTERN).first()).toBeVisible();
});

test('a first visit is to Learn, which opens on a player dealt face up', async ({ page }) => {
	await expect(page.getByRole('button', { name: 'Level: Learn' })).toBeVisible();
	await expect(progressSays(page, '6 to learn')).toBeVisible();
	// No medal to play for.
	await expect(progressMentions(page, 'medal')).toHaveCount(0);

	// The card says who wears the number, and asks nothing.
	const sweaterNumber = await drawnNumber(page);
	const wearers = SHORT_PLAYERS.filter((p) => p.sweaterNumber === sweaterNumber).map(fullName);
	const card = await deckSlot(page).ariaSnapshot();
	expect(wearers.some((name) => card.includes(name))).toBe(true);
	expect(card).toContain(`#${sweaterNumber}`);
	expect(card).not.toContain('Who wears this number?');

	// Nothing to answer: the one control is the way on.
	await expect(answers(page)).toHaveCount(1);
	await expect(nextButton(page)).toBeVisible();
	await expect(page.getByRole('status')).toBeEmpty();

	// Moving on is announced, with what is up now, and focus is kept off <body>.
	await nextButton(page).click();
	await expect(page.getByRole('status')).toHaveText(/^New: #\d+ is .+\.$/);
	await expect(page.getByRole('group', { name: 'Answer choices' })).toBeFocused();
	await expect(progressSays(page, '6 to learn')).toBeVisible();
});

test('plays from introductions, through an open-book quiz, to a scored final lap', async ({
	page
}) => {
	const learned: FixturePlayer[] = [];
	const lap = progressSays(page, 'Final lap: 6 left');

	// The first batch. Questions offer only players already introduced, never
	// more than three of them.
	for (let turn = 0; learned.length === 0; turn++) {
		expect(turn).toBeLessThan(10);
		if ((await nextButton(page).count()) === 0) {
			expect(await answers(page).count()).toBeLessThanOrEqual(3);
			expect(await answers(page).count()).toBeGreaterThan(1);
		}
		const named = await advance(page);
		if (named) learned.push(named);
	}
	await expect(progressSays(page, '5 to learn')).toBeVisible();

	// An open book: once a player is learned the roster shows their number.
	// Looked at on an introduction, when nobody is being offered as an answer.
	for (let turn = 0; (await nextButton(page).count()) === 0; turn++) {
		expect(turn).toBeLessThan(10);
		const named = await advance(page);
		if (named) learned.push(named);
	}
	for (const player of learned) {
		await expect(rosterEntry(page, player)).toContainText(String(player.sweaterNumber));
	}

	// A reload picks Learn back up where it was, without announcing anything.
	const stored = await page.evaluate((key) => sessionStorage.getItem(key), SAVED_GAME);
	expect(stored).not.toBeNull();
	await page.reload();
	await expect(nextButton(page)).toBeVisible();
	await expect(progressSays(page, `${6 - learned.length} to learn`)).toBeVisible();
	await expect(page.getByRole('status')).toBeEmpty();
	expect(await page.evaluate((key) => sessionStorage.getItem(key), SAVED_GAME)).toBe(stored);

	// On through the rest, until everyone has been learned once.
	for (let turn = 0; (await lap.count()) === 0; turn++) {
		expect(turn).toBeLessThan(40);
		await advance(page);
	}

	// The final lap: announced, three names from the whole roster, and the
	// book shut. Nobody's number is in the roster any more.
	await expect(page.getByRole('status')).toContainText('Final lap: every player once more');
	await expect(answers(page)).toHaveCount(3);
	for (const player of SHORT_PLAYERS) {
		await expect(rosterEntry(page, player)).toHaveCount(1);
		await expect(rosterEntry(page, player)).not.toContainText(String(player.sweaterNumber));
	}

	for (let turn = 0; (await playAgain(page).count()) === 0; turn++) {
		expect(turn).toBeLessThan(10);
		await advance(page);
	}

	// Scored on the lap, with no medal: what Learn leads to is the first level
	// that has one.
	const summary = page.getByRole('group', { name: 'Congratulations!' });
	await expect(summary).toBeFocused();
	await expect(summary).toContainText('First try: 6 / 6');
	await expect(summary).not.toContainText('medal');
	await expect(page.getByText('Best this season at Learn: 6 / 6')).toBeVisible();

	await page.getByRole('button', { name: 'Try Easy' }).click();
	await expect(page.getByRole('button', { name: 'Level: Easy' })).toBeVisible();
	await expect(progressSays(page, '6 left')).toBeVisible();
	await expect(answers(page)).toHaveCount(5);
	await expect(progressMentions(page, 'No misses so far: bronze medal in reach')).toBeVisible();
});

test('a miss in the final lap is scored, and the player is asked twice more', async ({ page }) => {
	const lap = progressSays(page, 'Final lap: ');
	for (let turn = 0; (await lap.count()) === 0; turn++) {
		expect(turn).toBeLessThan(40);
		await advance(page);
	}

	// Miss the first card of the lap: pick someone who wears another number.
	const sweaterNumber = await drawnNumber(page);
	const names = (await answers(page).allInnerTexts()).map((n) => n.replace(/\s+/g, ' ').trim());
	const wrong = names.find(
		(name) => SHORT_PLAYERS.find((p) => fullName(p) === name)?.sweaterNumber !== sweaterNumber
	);
	if (!wrong) throw new Error(`Every answer on offer wears #${sweaterNumber}`);
	await page.getByRole('button', { name: wrong, exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Wrong');

	let guesses = 1;
	for (; (await playAgain(page).count()) === 0; guesses++) {
		expect(guesses).toBeLessThan(15);
		await advance(page);
	}

	// Six players, one of them named twice after the miss: right soon after
	// being corrected, then right again at the end.
	expect(guesses).toBe(8);
	const summary = page.getByRole('group', { name: 'Congratulations!' });
	await expect(summary).toContainText('First try: 5 / 6');
	await expect(page.getByRole('heading', { name: 'Missed on the first try' })).toBeVisible();
});
