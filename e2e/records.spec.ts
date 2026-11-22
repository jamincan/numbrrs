import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_TEAM, NUMBERLESS_TEAM, SHORT_PLAYERS, SHORT_TEAM } from './seed';

// Medals and best scores: earned on a team's page, kept in the browser's local
// storage, and shown on the home page. The short roster is used throughout so
// a whole game is six cards.

const GAME_PATH = `/game/${SHORT_TEAM.league}/${SHORT_TEAM.code}`;
const TEAM_ID = `${SHORT_TEAM.league}:${SHORT_TEAM.code}`;
const TEAM_NAME = 'Montréal Canadiens';
const RECORDS = 'numbrrs_records';
const NUMBER_PATTERN = /^#\d+$/;

/** The season a record made now belongs to: it turns over on September 1. The
 *  browser and this process share a clock and a time zone. */
function season(): number {
	const now = new Date();
	return now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
}

function fullName(player: { firstName: string; lastName: string }): string {
	return `${player.firstName} ${player.lastName}`;
}

function drawnCard(page: Page) {
	return page.locator('.card-slot').first().getByText(NUMBER_PATTERN).first();
}

async function chooseLevel(page: Page, level: string) {
	await page.getByRole('button', { name: 'Level' }).click();
	await page.getByRole('menuitemradio', { name: level }).click();
}

/** Answer the card that's up: rightly, or with someone who wears another number. */
async function answer(page: Page, right: boolean) {
	const sweaterNumber = Number((await drawnCard(page).innerText()).slice(1));
	for (const player of SHORT_PLAYERS) {
		if ((player.sweaterNumber === sweaterNumber) !== right) continue;
		const button = page.getByRole('button', { name: fullName(player), exact: true });
		if ((await button.count()) === 0) continue;
		await button.click();
		await expect(page.getByRole('status')).toContainText(right ? 'Correct' : 'Wrong');
		return;
	}
	throw new Error(`No ${right ? 'right' : 'wrong'} answer on offer for #${sweaterNumber}`);
}

/** Play the roster to the end at a level, missing the first card if asked to. */
async function play(page: Page, level: string, { miss = false } = {}) {
	const playAgain = page.getByRole('button', { name: 'Play Again' });
	await page.goto(GAME_PATH);
	// A game finished earlier in the test is kept for the tab, and comes back
	// finished: start a new one.
	await expect(drawnCard(page).or(playAgain)).toBeVisible();
	if ((await playAgain.count()) > 0) await playAgain.click();
	await expect(drawnCard(page)).toBeVisible();
	await chooseLevel(page, level);
	if (miss) await answer(page, false);
	for (let turn = 0; (await playAgain.count()) === 0; turn++) {
		expect(turn).toBeLessThan(10);
		await answer(page, true);
	}
}

function stored(page: Page) {
	return page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), RECORDS);
}

/** Put records in this browser's storage, as an earlier visit would have. */
async function seed(page: Page, year: number, medal: string) {
	await page.goto('/how-to-play');
	await page.evaluate(
		([key, value]) => localStorage.setItem(key!, value!),
		[
			RECORDS,
			JSON.stringify({
				v: 1,
				teams: {
					[TEAM_ID]: {
						completed: true,
						// As it would be for a team played to the end: everyone on it named.
						known: SHORT_PLAYERS.map((p) => `${p.id}:${p.sweaterNumber}`),
						seasons: { [year]: { medal, best: { hard: [6, 6] } } }
					}
				}
			})
		]
	);
}

const tile = (page: Page) => page.getByRole('link', { name: new RegExp(`${TEAM_NAME}$`) });
const goldOnTab = (page: Page) => page.getByRole('link', { name: /gold for \d+ of \d+ teams/ });

test('a perfect run earns the level’s medal, and the home page shows it on the team’s tile', async ({
	page
}) => {
	await play(page, 'Easy');

	const summary = page.getByRole('group', { name: 'Congratulations!' });
	await expect(summary).toContainText('First try: 6 / 6');
	await expect(summary).toContainText('Perfect run: bronze medal');
	await expect(page.getByText('Best this season at Easy: 6 / 6')).toBeVisible();
	// Beside the team's name from now on.
	await expect(
		page.getByRole('img', { name: /^Bronze medal: a perfect run at Easy, \d{4}.\d{2} season$/ })
	).toBeVisible();

	const team = (await stored(page)).teams[TEAM_ID];
	expect(team.seasons[season()]).toEqual({ medal: 'bronze', best: { easy: [6, 6] } });
	expect(team.completed).toBe(true);
	// Every player on the roster has now been named correctly.
	expect(team.known).toHaveLength(SHORT_PLAYERS.length);

	await page.goto('/');
	await expect(tile(page)).toHaveAccessibleName(`bronze medal ${TEAM_NAME}`);
	await expect(tile(page).locator('svg[data-medal="bronze"]')).toBeVisible();
	// Bronze is not gold: the league's tab counts nothing yet.
	await expect(goldOnTab(page)).toHaveCount(0);
});

test('gold for a team is counted on its league’s tab', async ({ page }) => {
	await play(page, 'Hard');
	await expect(page.getByRole('group', { name: 'Congratulations!' })).toContainText(
		'Perfect run: gold medal'
	);

	await page.goto('/');
	await expect(tile(page)).toHaveAccessibleName(`gold medal ${TEAM_NAME}`);
	await expect(goldOnTab(page)).toHaveCount(1);
	await expect(goldOnTab(page)).toHaveAccessibleName(/^NHL gold for 1 of \d+ teams$/);
	await expect(goldOnTab(page)).toContainText(/1 \/ \d+/);
});

test('a run with a miss earns no medal but keeps its score, and never costs a medal already won', async ({
	page
}) => {
	await play(page, 'Medium');
	await expect(
		page.getByRole('img', { name: /^Silver medal: a perfect run at Medium, / })
	).toBeVisible();

	await play(page, 'Hard', { miss: true });
	const summary = page.getByRole('group', { name: 'Congratulations!' });
	await expect(summary).toContainText('First try: 5 / 6');
	await expect(summary).not.toContainText('medal');
	await expect(page.getByText('Best this season at Hard: 5 / 6')).toBeVisible();

	expect((await stored(page)).teams[TEAM_ID].seasons[season()]).toEqual({
		medal: 'silver',
		best: { medium: [6, 6], hard: [5, 6] }
	});
	await page.goto('/');
	await expect(tile(page)).toHaveAccessibleName(`silver medal ${TEAM_NAME}`);
});

test('a finished game that is reloaded shows its record without earning it again', async ({
	page
}) => {
	await play(page, 'Easy');
	const before = JSON.stringify(await stored(page));

	await page.reload();
	await expect(page.getByRole('group', { name: 'Congratulations!' })).toContainText(
		'Perfect run: bronze medal'
	);
	await expect(page.getByText('Best this season at Easy: 6 / 6')).toBeVisible();
	expect(JSON.stringify(await stored(page))).toBe(before);
});

test('last season’s medal is not this season’s', async ({ page }) => {
	await seed(page, season() - 1, 'gold');

	await page.goto('/');
	await expect(tile(page)).toHaveAccessibleName(TEAM_NAME);
	await expect(goldOnTab(page)).toHaveCount(0);

	// And this season's is.
	await seed(page, season(), 'gold');
	await page.goto('/');
	await expect(tile(page)).toHaveAccessibleName(`gold medal ${TEAM_NAME}`);
});

test.describe('the rules page', () => {
	test('explains the levels, in both languages, and is linked from the footer and the level menu', async ({
		page
	}) => {
		await page.goto('/');
		await page
			.getByRole('navigation', { name: 'Footer' })
			.getByRole('link', { name: 'How to play' })
			.click();
		await expect(page).toHaveURL('/how-to-play');
		await expect(page.getByRole('heading', { level: 1, name: 'How to play' })).toBeVisible();
		for (const level of [
			'Learn: 3 choices',
			'Easy: 5 choices',
			'Medium: 10 choices',
			'Hard: full roster'
		]) {
			await expect(page.getByText(level, { exact: true })).toBeVisible();
		}
		await expect(page.getByRole('img', { name: 'gold medal' })).toBeVisible();

		await page.goto('/fr/how-to-play');
		await expect(page.getByRole('heading', { level: 1, name: 'Comment jouer' })).toBeVisible();
		await expect(page.locator('html')).toHaveAttribute('lang', 'fr');

		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		await page.getByRole('button', { name: 'Level' }).click();
		await page.getByRole('menuitem', { name: 'How to play' }).click();
		await expect(page).toHaveURL('/how-to-play');
	});

	test('says so when there is nothing to reset', async ({ page }) => {
		await page.goto('/how-to-play');

		await expect(page.getByText('Nothing is recorded yet.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reset my records' })).toHaveCount(0);
	});

	test('resets the records, but only after asking', async ({ page }) => {
		await seed(page, season(), 'gold');
		await page.reload();

		const reset = page.getByRole('button', { name: 'Reset my records' });
		const question = page.getByRole('group', { name: 'Reset my records' });
		await reset.click();
		await expect(question).toBeFocused();
		await expect(question).toContainText('This can’t be undone.');

		// Backing out changes nothing, and hands focus back to the button.
		await page.getByRole('button', { name: 'Keep them' }).click();
		await expect(reset).toBeFocused();
		expect(await stored(page)).not.toBeNull();

		await reset.click();
		await page.getByRole('button', { name: 'Erase them' }).click();
		const done = page.getByRole('status').filter({ hasText: 'Your records have been erased.' });
		await expect(done).toBeFocused();
		await expect(reset).toHaveCount(0);
		expect(await stored(page)).toBeNull();

		await page.goto('/');
		await expect(tile(page)).toHaveAccessibleName(TEAM_NAME);
		await expect(goldOnTab(page)).toHaveCount(0);
	});
});

test.describe('players new to a roster', () => {
	// The last player on the short roster, who wears a number nobody else does.
	const newcomer = SHORT_PLAYERS[SHORT_PLAYERS.length - 1]!;
	const pair = (player: (typeof SHORT_PLAYERS)[number]) => `${player.id}:${player.sweaterNumber}`;
	const badge = (page: Page) => page.getByText(/^\d+ new$/);

	/** Records of someone who has named everyone on the team but the newcomer. */
	async function seedKnown(page: Page, completed: boolean) {
		await page.goto('/how-to-play');
		await page.evaluate(
			([key, value]) => localStorage.setItem(key!, value!),
			[
				RECORDS,
				JSON.stringify({
					v: 1,
					teams: {
						[TEAM_ID]: {
							completed,
							known: SHORT_PLAYERS.filter((p) => p !== newcomer).map(pair),
							seasons: completed ? { [season()]: { medal: 'gold', best: { hard: [5, 5] } } } : {}
						}
					}
				})
			]
		);
	}

	test('are counted on the tile of a team played to the end, and learned in a round of their own', async ({
		page
	}) => {
		await seedKnown(page, true);

		// One team has been finished, and one player on it has not been named.
		await page.goto('/');
		await expect(badge(page)).toHaveCount(1);
		await expect(tile(page).getByText('1 new', { exact: true })).toBeVisible();
		// The medal is untouched by the roster having changed.
		await expect(tile(page).locator('svg[data-medal="gold"]')).toBeVisible();

		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		const learnNew = page.getByRole('button', { name: 'Learn 1 new' });
		await learnNew.click();

		// A round of Learn about that one player: dealt face up, with the rest of
		// the roster already filled in.
		await expect(page.getByRole('button', { name: 'Level: Learn' })).toBeVisible();
		await expect(page.getByText('1 to learn')).toBeVisible();
		await expect(page.locator('.card-slot').first()).toContainText(fullName(newcomer));
		await expect(learnNew).toHaveCount(0);
		const known = SHORT_PLAYERS[0]!;
		await expect(page.locator('li').filter({ hasText: fullName(known) })).toContainText(
			String(known.sweaterNumber)
		);

		const next = page.getByRole('button', { name: 'Next', exact: true });
		const playAgain = page.getByRole('button', { name: 'Play Again' });
		for (let turn = 0; (await playAgain.count()) === 0; turn++) {
			expect(turn).toBeLessThan(12);
			if ((await next.count()) > 0) await next.click();
			else await answer(page, true);
		}

		// Scored out of the one player it was about, and not as a run at the roster.
		await expect(page.getByRole('group', { name: 'Congratulations!' })).toContainText(
			'First try: 1 / 1'
		);
		await expect(page.getByText(/Best this season/)).toHaveCount(0);
		await expect(learnNew).toHaveCount(0);
		const team = (await stored(page)).teams[TEAM_ID];
		expect(team.known).toContain(pair(newcomer));
		expect(team.seasons[season()]).toEqual({ medal: 'gold', best: { hard: [5, 5] } });

		await page.goto('/');
		await expect(tile(page)).toHaveAccessibleName(`gold medal ${TEAM_NAME}`);
		await expect(badge(page)).toHaveCount(0);
	});

	test('are not counted on a team that has never been played to the end', async ({ page }) => {
		await seedKnown(page, false);

		await page.goto('/');
		await expect(tile(page)).toHaveAccessibleName(TEAM_NAME);
		await expect(badge(page)).toHaveCount(0);

		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		await expect(page.getByRole('button', { name: /^Learn \d+ new$/ })).toHaveCount(0);
	});
});

test('a medal says what it was won for when the pointer is over it', async ({ page }) => {
	await seed(page, season(), 'gold');
	const years = `${season()}–${String(season() + 1).slice(-2)}`;
	const achievement = `Gold medal: a perfect run at Hard, ${years} season`;

	// On the team's tile: hidden until the medal is hovered over.
	await page.goto('/');
	const onTile = tile(page).locator('[data-medal-tip]');
	await expect(onTile).toBeHidden();
	await tile(page).locator('svg[data-medal="gold"]').hover();
	await expect(onTile).toBeVisible();
	await expect(onTile).toHaveText(achievement);
	// And for a keyboard, while the tile has focus.
	await page.mouse.move(0, 0);
	await expect(onTile).toBeHidden();
	await tile(page).focus();
	await page.keyboard.press('Shift+Tab');
	await page.keyboard.press('Tab');
	await expect(tile(page)).toBeFocused();
	await expect(onTile).toBeVisible();

	// On the team's page, hanging in the rafters: the same words, which are
	// also what the medal is called there.
	await page.goto(GAME_PATH);
	await expect(drawnCard(page)).toBeVisible();
	const hung = page.getByRole('img', { name: achievement });
	const tip = page.locator('[data-medal-tip]');
	await expect(hung).toBeVisible();
	await expect(tip).toBeHidden();
	await hung.hover();
	await expect(tip).toBeVisible();
	await expect(tip).toHaveText(achievement);

	// In French, on the French page.
	await page.goto(`/fr${GAME_PATH}`);
	await expect(drawnCard(page)).toBeVisible();
	await expect(
		page.getByRole('img', {
			name: /^Médaille d’or.: un sans-faute au niveau Difficile, saison \d{4}-\d{4}$/
		})
	).toBeVisible();
});

// A league's trophy, for gold on every one of its teams: it stands above the
// home page's title. The fixture has three teams, all in the NHL, so the
// Stanley Cup is the one there is to win.
test.describe('league trophies', () => {
	const NHL = [FIXTURE_TEAM, SHORT_TEAM, NUMBERLESS_TEAM].map((t) => `${t.league}:${t.code}`);
	const title = (page: Page) => page.getByRole('heading', { level: 1, name: 'Numbrrs' });
	const trophies = (page: Page, name = 'Trophies') => page.getByRole('list', { name });

	/** Records of someone holding gold this season for each of these teams. */
	async function seedGold(page: Page, teamIds: string[]) {
		const gold = {
			completed: true,
			known: [],
			seasons: { [season()]: { medal: 'gold', best: { hard: [5, 5] } } }
		};
		await page.goto('/how-to-play');
		await page.evaluate(
			([key, value]) => localStorage.setItem(key!, value!),
			[
				RECORDS,
				JSON.stringify({ v: 1, teams: Object.fromEntries(teamIds.map((id) => [id, gold])) })
			]
		);
	}

	test('stands above the title, which stays where it was', async ({ page }) => {
		await page.goto('/');
		await expect(title(page)).toBeVisible();
		await expect(trophies(page)).toHaveCount(0);
		const before = await title(page).boundingBox();

		await seedGold(page, NHL);
		await page.goto('/');
		const cup = trophies(page).getByRole('img');
		await expect(cup).toHaveCount(1);
		await expect(cup).toHaveAccessibleName(
			/^Stanley Cup: gold for every NHL team, \d{4}–\d{2} season$/
		);

		// On the page, above the title, and centred on it.
		const [after, box] = [await title(page).boundingBox(), await cup.boundingBox()];
		expect(after).toEqual(before);
		expect(box!.y).toBeGreaterThanOrEqual(0);
		expect(box!.y + box!.height).toBeLessThanOrEqual(after!.y + 6);
		expect(box!.height).toBeGreaterThan(80);
		expect(Math.abs(box!.x + box!.width / 2 - (after!.x + after!.width / 2))).toBeLessThan(2);

		// What it was won for, on hovering over it.
		const tip = page.locator('[data-trophy-tip]');
		await expect(tip).toBeHidden();
		await cup.hover();
		await expect(tip).toBeVisible();
		await expect(tip).toHaveText(/^Stanley Cup: gold for every NHL team/);
	});

	test('takes gold on every team in the league', async ({ page }) => {
		await seedGold(page, NHL.slice(1));
		await page.goto('/');
		// The medals have been read, and there is no trophy.
		await expect(page.getByText('2 / 3')).toBeVisible();
		await expect(trophies(page)).toHaveCount(0);
	});

	test('has its French name on the French page', async ({ page }) => {
		await seedGold(page, NHL);
		await page.goto('/fr');
		await expect(trophies(page, 'Trophées').getByRole('img')).toHaveAccessibleName(
			/^Coupe Stanley\u00a0: l’or pour toutes les équipes de la LNH, saison \d{4}-\d{4}$/
		);
	});

	test('is a size smaller on a phone, under the nav, and still leaves the title alone', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await page.goto('/');
		const before = await title(page).boundingBox();

		await seedGold(page, NHL);
		await page.goto('/');
		const cup = trophies(page).getByRole('img');
		await expect(cup).toBeVisible();
		const [after, box] = [await title(page).boundingBox(), await cup.boundingBox()];
		expect(after).toEqual(before);
		expect(box!.height).toBe(48);
		// Right under the site nav, and clear of the title.
		const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
		expect(box!.y).toBe(nav!.y + nav!.height);
		expect(box!.y + box!.height).toBeLessThanOrEqual(after!.y + 6);
	});

	test('leaves the league tabs on one row on a phone, counts and all', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 800 });
		await seedGold(page, NHL);
		await page.goto('/');
		await expect(page.getByText('3 / 3')).toBeVisible();
		const tabs = page.getByRole('navigation', { name: 'League' }).getByRole('link');
		const tops = await tabs.evaluateAll((links) => links.map((a) => a.getBoundingClientRect().top));
		expect(tops).toHaveLength(5);
		expect(new Set(tops).size).toBe(1);
	});
});

// Someone with nothing on record is shown where the level is changed: the
// button for it is small, and up in the site nav.
test.describe('the level hint on a first visit', () => {
	const hint = (page: Page) => page.locator('[data-level-hint]');
	const levelButton = (page: Page) => page.getByRole('button', { name: /^Level: / });

	test('points at the level button until it is sent away, which is remembered', async ({
		page
	}) => {
		await page.goto(GAME_PATH);
		await expect(hint(page)).toBeVisible();
		await expect(hint(page)).toContainText('Want a challenge? Change the level here.');
		// Those words are the button's description, so they are read out with it.
		await expect(levelButton(page)).toHaveAccessibleDescription(
			'Want a challenge? Change the level here.'
		);
		// And the rules, which say what each level is, are a link away.
		await expect(hint(page).getByRole('link', { name: 'How to play' })).toHaveAttribute(
			'href',
			'/how-to-play'
		);

		// It hangs over the top of the game, and must not cover the way on.
		await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Next', exact: true }).click({ trial: true });

		// Under the button, ending where it ends, and on the screen.
		const [bubble, button] = [
			await hint(page).boundingBox(),
			await levelButton(page).boundingBox()
		];
		expect(bubble!.y).toBeGreaterThanOrEqual(button!.y + button!.height);
		expect(Math.abs(bubble!.x + bubble!.width - (button!.x + button!.width))).toBeLessThan(2);
		expect(bubble!.x).toBeGreaterThanOrEqual(0);

		await hint(page).getByRole('button', { name: 'Dismiss' }).click();
		await expect(hint(page)).toHaveCount(0);
		await expect(levelButton(page)).toHaveAccessibleDescription('');

		// Sent away for good, though nothing is on record yet: a note of it is
		// kept beside the records.
		expect(await page.evaluate(() => localStorage.getItem('numbrrs_level_hint'))).toBe('1');
		expect(await stored(page)).toBeNull();
		await page.reload();
		await expect(drawnCard(page)).toBeVisible();
		await expect(levelButton(page)).toBeVisible();
		await expect(hint(page)).toHaveCount(0);
	});

	test('goes when the menu is opened, which is what it was for', async ({ page }) => {
		await page.goto(GAME_PATH);
		await expect(hint(page)).toBeVisible();
		await levelButton(page).click();
		await expect(page.getByRole('menu', { name: 'Level' })).toBeVisible();
		await expect(hint(page)).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu', { name: 'Level' })).toHaveCount(0);
		await expect(hint(page)).toHaveCount(0);

		// And stays gone: whoever opened the menu has found it.
		await page.reload();
		await expect(drawnCard(page)).toBeVisible();
		await expect(levelButton(page)).toBeVisible();
		await expect(hint(page)).toHaveCount(0);
	});

	test('goes when its link to the rules is followed', async ({ page }) => {
		await page.goto(GAME_PATH);
		await hint(page).getByRole('link', { name: 'How to play' }).click();
		await expect(page).toHaveURL(/\/how-to-play$/);
		await expect(page.getByRole('heading', { level: 1, name: 'How to play' })).toBeVisible();

		await page.goBack();
		await expect(drawnCard(page)).toBeVisible();
		await expect(levelButton(page)).toBeVisible();
		await expect(hint(page)).toHaveCount(0);
	});

	test('goes with the first right answer, for good', async ({ page }) => {
		await page.goto(GAME_PATH);
		await expect(hint(page)).toBeVisible();

		// Learn opens on players dealt face up: on past those to a question.
		const next = page.getByRole('button', { name: 'Next', exact: true });
		for (let turn = 0; (await next.count()) > 0; turn++) {
			expect(turn).toBeLessThan(10);
			// Still there: looking at a card is not history.
			await expect(hint(page)).toBeVisible();
			await next.click();
		}
		await answer(page, true);
		await expect(hint(page)).toHaveCount(0);

		// That answer is on record, so this is no longer a first visit.
		await page.reload();
		await expect(drawnCard(page)).toBeVisible();
		await expect(levelButton(page)).toBeVisible();
		await expect(hint(page)).toHaveCount(0);
	});

	test('is not shown to someone with a record', async ({ page }) => {
		await seed(page, season(), 'gold');
		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		await expect(levelButton(page)).toBeVisible();
		await expect(hint(page)).toHaveCount(0);
	});

	test('fits on a small phone, in French', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await page.goto('/fr' + GAME_PATH);
		await expect(hint(page)).toBeVisible();
		await expect(hint(page)).toContainText('Envie d’un défi? Changez de niveau ici.');
		await expect(hint(page).getByRole('link', { name: 'Comment jouer' })).toHaveAttribute(
			'href',
			'/fr/how-to-play'
		);
		await expect(hint(page).getByRole('button', { name: 'Fermer' })).toBeVisible();
		const box = await hint(page).boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(320);
	});
});
