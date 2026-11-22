import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_PLAYERS, FIXTURE_TEAM } from './seed';

const NUMBER_PATTERN = /^#\d+$/;
const SAVED_GAME = `numbrrs_game:${FIXTURE_TEAM.league}:${FIXTURE_TEAM.code}`;

/** The progress bar, when what it says starts with this: the count of players
 *  left, which is said and not shown. */
const progressSays = (page: Page, text: string) =>
	page.locator(`[role="progressbar"][aria-valuetext^="${text}"]`);
/** And when it says this anywhere: what has become of the medal. */
const progressMentions = (page: Page, text: string) =>
	page.locator(`[role="progressbar"][aria-valuetext*="${text}"]`);

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

/** A numbered player who is not the answer to the card that's up. */
function someoneElse(sweaterNumber: number) {
	const wrong = FIXTURE_PLAYERS.find(
		(p) => p.sweaterNumber !== null && p.sweaterNumber !== sweaterNumber
	);
	if (!wrong) throw new Error('Fixture needs at least two numbered players');
	return wrong;
}

async function chooseLevel(page: Page, level: string) {
	await page.getByRole('button', { name: 'Level' }).click();
	await page.getByRole('menuitemradio', { name: level }).click();
}

/** The names that can be picked for the card that's up, in the order shown.
 *  Only a player on offer is a button, in either drawer layout. */
function offered(page: Page) {
	return page.getByRole('group', { name: 'Answer choices' }).getByRole('button');
}

async function offeredNames(page: Page): Promise<string[]> {
	return (await offered(page).allInnerTexts()).map((name) => name.replace(/\s+/g, ' ').trim());
}

/** A player's entry in the roster, shown in full at the default viewport. */
function rosterEntry(page: Page, player: { firstName: string; lastName: string }) {
	return page.locator('li').filter({ hasText: fullName(player) });
}

test.beforeEach(async ({ page }) => {
	await page.goto(`/game/${FIXTURE_TEAM.league}/${FIXTURE_TEAM.code}`);
	await expect(page.locator('.card-slot').first().getByText(NUMBER_PATTERN).first()).toBeVisible();
});

test('reaches a playable state with a card showing a number', async ({ page }) => {
	const number = await drawnNumber(page);
	expect(playerFor(number)).toBeTruthy();
	await expect(page.getByRole('button', { name: 'Level' })).toBeVisible();
});

test('a correct guess finds the player', async ({ page }) => {
	await chooseLevel(page, 'Easy');
	// One fixture player has no sweater number, so ten of the eleven are asked about.
	await expect(progressSays(page, '10 left')).toBeVisible();

	const player = playerFor(await drawnNumber(page));
	await page.getByRole('button', { name: fullName(player) }).click();

	const status = page.getByRole('status');
	await expect(status).toContainText('Correct');
	await expect(status).toContainText(fullName(player));
	await expect(progressSays(page, '9 left')).toBeVisible();
});

test('an incorrect guess finds nobody, and says what the player picked wears', async ({ page }) => {
	// Hard offers every numbered player, so anyone other than the drawn one is
	// guaranteed to be clickable.
	await chooseLevel(page, 'Hard');

	const sweaterNumber = await drawnNumber(page);
	const wrong = someoneElse(sweaterNumber);
	await expect(progressSays(page, '10 left')).toBeVisible();
	await page.getByRole('button', { name: fullName(wrong) }).click();

	const picked = `${fullName(wrong)} wears #${wrong.sweaterNumber}.`;
	const status = page.getByRole('status');
	await expect(status).toContainText(
		`Wrong — #${sweaterNumber} is ${fullName(playerFor(sweaterNumber))}.`
	);
	await expect(status).toContainText(picked);
	// On the page as well as read out: exact, so this is the line under the
	// cards and not the announcement that contains it.
	await expect(page.getByText(picked, { exact: true })).toBeVisible();
	await expect(progressSays(page, '10 left')).toBeVisible();
});

test('a miss puts the medal out of reach, and a restart brings it back', async ({ page }) => {
	await chooseLevel(page, 'Hard');
	const inReach = progressMentions(page, 'No misses so far: gold medal in reach');
	const lost = progressMentions(page, 'No medal this run');
	const restart = page.getByRole('button', { name: 'Restart' });
	await expect(inReach).toBeVisible();
	await expect(restart).toHaveCount(0);

	// A right answer leaves it where it was.
	const first = playerFor(await drawnNumber(page));
	await page.getByRole('button', { name: fullName(first) }).click();
	await expect(progressSays(page, '9 left')).toBeVisible();
	await expect(inReach).toBeVisible();

	await page.getByRole('button', { name: fullName(someoneElse(await drawnNumber(page))) }).click();
	await expect(lost).toBeVisible();
	await expect(inReach).toHaveCount(0);

	await restart.click();
	await expect(progressSays(page, '10 left')).toBeVisible();
	await expect(inReach).toBeVisible();
	await expect(restart).toHaveCount(0);
	await expect(page.getByRole('status')).toBeEmpty();
	// The button that was pressed is gone; focus goes to the answers, not to
	// the top of the page.
	await expect(page.getByRole('group', { name: 'Answer choices' })).toBeFocused();
	expect(await page.evaluate((key) => sessionStorage.getItem(key), SAVED_GAME)).toBeNull();
});

test('a quiz level keeps every number out of the roster, and goes on offering players already found', async ({
	page
}) => {
	await chooseLevel(page, 'Easy');
	await expect(progressMentions(page, 'No misses so far: bronze medal in reach')).toBeVisible();

	const found: (typeof FIXTURE_PLAYERS)[number][] = [];
	for (let turn = 0; turn < 4; turn++) {
		// Five names on every card, however many players have been found.
		await expect(offered(page)).toHaveCount(5);
		const player = playerFor(await drawnNumber(page));
		await page.getByRole('button', { name: fullName(player) }).click();
		found.push(player);
		await expect(progressSays(page, `${9 - turn} left`)).toBeVisible();
	}

	for (const player of found) {
		await expect(rosterEntry(page, player)).toHaveCount(1);
		await expect(rosterEntry(page, player)).not.toContainText(String(player.sweaterNumber));
	}
	// The player with no number gives nothing away, and is marked as before.
	const numberless = FIXTURE_PLAYERS.find((p) => p.sweaterNumber === null)!;
	await expect(rosterEntry(page, numberless)).toContainText('--');
});

test('Hard offers the whole roster, by position and then by name, the same for every card', async ({
	page
}) => {
	await chooseLevel(page, 'Hard');

	// Not the order the players are stored in, which is the league feed's and
	// can be by sweater number.
	const expected = [
		'Matthew Knies',
		'Mitch Marner',
		'Auston Matthews',
		'William Nylander',
		'John Tavares',
		'Jake McCabe',
		'Morgan Rielly',
		'Chris Tanev',
		'Anthony Stolarz',
		'Joseph Woll'
	];
	expect(await offeredNames(page)).toEqual(expected);

	const player = playerFor(await drawnNumber(page));
	await page.getByRole('button', { name: fullName(player) }).click();
	await expect(progressSays(page, '9 left')).toBeVisible();
	expect(await offeredNames(page)).toEqual(expected);
});

test('changing between quiz levels before the first guess re-deals options without changing the drawn card', async ({
	page
}) => {
	await chooseLevel(page, 'Easy');
	const before = await drawnNumber(page);
	await expect(offered(page)).toHaveCount(5);

	await chooseLevel(page, 'Hard');

	await expect(offered(page)).toHaveCount(10);
	expect(await drawnNumber(page)).toBe(before);
});

test('changing to or from Learn starts the game over, whatever has been done in it', async ({
	page
}) => {
	const savedGame = () => page.evaluate((key) => sessionStorage.getItem(key), SAVED_GAME);
	const next = page.getByRole('button', { name: 'Next', exact: true });

	// A first visit is to Learn, which opens on a player being introduced.
	await expect(progressSays(page, '10 to learn')).toBeVisible();
	await next.click();
	expect(await savedGame()).not.toBeNull();

	await chooseLevel(page, 'Easy');

	await expect(progressSays(page, '10 left')).toBeVisible();
	await expect(page.getByRole('status')).toBeEmpty();
	await expect(offered(page)).toHaveCount(5);
	// Nothing of the Learn game is kept to come back to.
	expect(await savedGame()).toBeNull();

	const player = playerFor(await drawnNumber(page));
	await page.getByRole('button', { name: fullName(player) }).click();
	await expect(progressSays(page, '9 left')).toBeVisible();

	await chooseLevel(page, 'Learn');

	await expect(progressSays(page, '10 to learn')).toBeVisible();
	await expect(next).toBeVisible();
	await expect(page.getByRole('status')).toBeEmpty();
	expect(await savedGame()).toBeNull();
});

test('the level menu says what each level offers and the medal it plays for', async ({ page }) => {
	await page.getByRole('button', { name: 'Level' }).click();

	// By accessible name: the words on the row, then the medal pictured beside
	// them. Learn plays for none.
	const rows = page.getByRole('menuitemradio');
	await expect(rows).toHaveCount(4);
	await expect(rows.nth(0)).toHaveAccessibleName('Learn: 3 choices');
	await expect(rows.nth(1)).toHaveAccessibleName('Easy: 5 choices bronze medal');
	await expect(rows.nth(2)).toHaveAccessibleName('Medium: 10 choices silver medal');
	await expect(rows.nth(3)).toHaveAccessibleName('Hard: full roster gold medal');
	await expect(page.getByRole('menu').locator('svg[data-medal]')).toHaveCount(3);
});

test('the level in play is kept in local storage, from the first game on', async ({ page }) => {
	const stored = () => page.evaluate(() => localStorage.getItem('numbrrs_difficulty'));

	// Before anything is chosen: the default is written as soon as a game starts.
	expect(await stored()).toBe('learn');

	await chooseLevel(page, 'Hard');
	expect(await stored()).toBe('hard');

	await page.reload();
	await expect(page.getByRole('button', { name: 'Level: Hard' })).toBeVisible();
	expect(await stored()).toBe('hard');
});

for (const [old, name, level] of [
	['2', 'Learn', 'learn'],
	['4', 'Easy', 'easy'],
	['8', 'Medium', 'medium'],
	['Infinity', 'Hard', 'hard']
] as const) {
	test(`a setting saved as ${old} answers carries over as ${name}`, async ({ page }) => {
		await page.evaluate((value) => localStorage.setItem('numbrrs_difficulty', value), old);

		await page.reload();

		await expect(page.getByRole('button', { name: `Level: ${name}` })).toBeVisible();
		expect(await page.evaluate(() => localStorage.getItem('numbrrs_difficulty'))).toBe(level);
	});
}
