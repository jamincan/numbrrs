import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_PLAYERS, FIXTURE_TEAM } from './seed';

const GAME_PATH = `/game/${FIXTURE_TEAM.league}/${FIXTURE_TEAM.code}`;

// The fixture's roster as the drawer lists it: by position, then by name. Not
// the order the players are stored in.
const POSITIONS = {
	Forwards: [
		'Matthew Knies',
		'Mitch Marner',
		'Auston Matthews',
		'William Nylander',
		'John Tavares'
	],
	Defence: ['Jake McCabe', 'Morgan Rielly', 'Chris Tanev'],
	Goalies: ['Anthony Stolarz', 'Joseph Woll']
};
const ROSTER_ORDER = Object.values(POSITIONS).flat();

const answers = (page: Page) => page.getByRole('group', { name: 'Answer choices' });
const toggle = (page: Page) => page.getByRole('button', { name: /^(show all|hide roster)$/ });

/** The names on the answer buttons, in the order they are on the page. */
async function offered(page: Page): Promise<string[]> {
	const names = await answers(page).getByRole('button').allInnerTexts();
	return names.map((name) => name.replace(/\s+/g, ' ').trim());
}

/** Start at a level, as a returning visitor's setting would. */
async function open(page: Page, level: string, width: number, height: number) {
	await page.addInitScript((value) => localStorage.setItem('numbrrs_difficulty', value), level);
	await page.setViewportSize({ width, height });
	await page.goto(GAME_PATH);
}

test('portrait: the drawer sits at the bottom, shut on the answers alone', async ({ page }) => {
	await open(page, 'easy', 390, 844);

	await expect(toggle(page)).toHaveAccessibleName('show all');
	await expect(answers(page).getByRole('button')).toHaveCount(5);
	// Nobody but the answers: the rest of the roster is not in the page.
	await expect(answers(page).getByRole('listitem')).toHaveCount(0);

	// In the roster's order, not the card's: by position, then by name.
	const names = await offered(page);
	expect(names).toEqual(ROSTER_ORDER.filter((name) => names.includes(name)));

	// Under the heading of each position that has an answer in it, and no other.
	for (const [heading, players] of Object.entries(POSITIONS)) {
		const wanted = players.some((name) => names.includes(name));
		await expect(answers(page).getByRole('heading', { name: heading, exact: true })).toHaveCount(
			wanted ? 1 : 0
		);
	}

	// Opened, it is the roster: everyone, with the same five still to choose from.
	await toggle(page).click();
	await expect(toggle(page)).toHaveAccessibleName('hide roster');
	await expect(answers(page).getByRole('listitem')).toHaveCount(FIXTURE_PLAYERS.length);
	for (const heading of Object.keys(POSITIONS)) {
		await expect(answers(page).getByRole('heading', { name: heading, exact: true })).toBeVisible();
	}
	expect(await offered(page)).toEqual(names);
});

test('landscape: the drawer is a full-height side panel, expanded by default', async ({ page }) => {
	await page.setViewportSize({ width: 1000, height: 500 });
	await page.goto(GAME_PATH);

	await expect(page.getByText('hide roster', { exact: false })).toBeVisible();
	await expect(page.getByText('Forwards')).toBeVisible();
	await expect(page.getByText('Defence', { exact: true })).toBeVisible();
	await expect(page.getByText('Goalies')).toBeVisible();
});

test('an introduction has nothing to choose from, so the shut drawer has no headings', async ({
	page
}) => {
	// A first visit: Learn, which opens on a player dealt face up.
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(GAME_PATH);

	await expect(answers(page).getByRole('button', { name: 'Next', exact: true })).toBeVisible();
	await expect(answers(page).getByRole('button')).toHaveCount(1);
	await expect(answers(page).getByRole('heading')).toHaveCount(0);
});

// Hard offers everyone with a number on every card. Shut or open the drawer
// would show the same thing, so it shows the roster and has no toggle.
for (const [shape, width, height] of [
	['portrait', 390, 844],
	['landscape', 1000, 500]
] as const) {
	test(`${shape}: at Hard the answers are the whole roster, and there is no toggle`, async ({
		page
	}) => {
		await open(page, 'hard', width, height);

		await expect(page.getByRole('button', { name: 'Level: Hard' })).toBeVisible();
		await expect(answers(page).getByRole('button')).toHaveCount(10);
		expect(await offered(page)).toEqual(ROSTER_ORDER);
		for (const heading of Object.keys(POSITIONS)) {
			await expect(
				answers(page).getByRole('heading', { name: heading, exact: true })
			).toBeVisible();
		}
		await expect(toggle(page)).toHaveCount(0);

		// A level with fewer answers than players has the toggle back, and the
		// drawer as its shape has it: shut along the bottom, open down the side.
		await page.getByRole('button', { name: 'Level: Hard' }).click();
		await page.getByRole('menuitemradio', { name: 'Easy' }).click();
		await expect(answers(page).getByRole('button')).toHaveCount(5);
		await expect(toggle(page)).toHaveAccessibleName(
			shape === 'portrait' ? 'show all' : 'hide roster'
		);
		await expect(answers(page).getByRole('listitem')).toHaveCount(
			shape === 'portrait' ? 0 : FIXTURE_PLAYERS.length
		);
	});
}
