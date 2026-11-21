import { test, expect, type Page } from '@playwright/test';
import { FIXTURE_PLAYERS, FIXTURE_TEAM, NUMBERLESS_TEAM } from './seed';

const NUMBER_PATTERN = /^#\d+$/;
const GAME_PATH = `/game/${FIXTURE_TEAM.league}/${FIXTURE_TEAM.code}`;

/** The front of the card in the draw pile. Once it is on screen the page has
 *  hydrated: the server's markup holds an undealt deck, and the first card is
 *  only turned up by the browser. */
function drawnCard(page: Page) {
	return page.locator('.card-slot').first().getByText(NUMBER_PATTERN).first();
}

async function playerOnCard(page: Page) {
	const sweaterNumber = Number((await drawnCard(page).innerText()).slice(1));
	const player = FIXTURE_PLAYERS.find((p) => p.sweaterNumber === sweaterNumber);
	if (!player) throw new Error(`No fixture player wears #${sweaterNumber}`);
	return { sweaterNumber, name: `${player.firstName} ${player.lastName}` };
}

test.describe('the cards, to a screen reader', () => {
	test('the card being asked about keeps its answer to itself', async ({ page }) => {
		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
		const { sweaterNumber, name } = await playerOnCard(page);

		const deck = page.locator('.card-slot').first();
		const question = await deck.ariaSnapshot();
		expect(question).toContain(`#${sweaterNumber}`);
		expect(question).toContain('Who wears this number?');
		expect(question).not.toContain(name);

		await page.getByRole('button', { name, exact: true }).click();

		// On the pile it is the other way round: the answer, not the question.
		const pile = page.locator('.card-slot').nth(1);
		await expect(pile.getByText('Correct!')).toBeVisible();
		const answer = await pile.ariaSnapshot();
		expect(answer).toContain(name);
		expect(answer).not.toContain('Who wears this number?');
	});
});

test.describe('the difficulty menu, by keyboard', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();
	});

	test('opens on the current setting and moves with the arrow keys', async ({ page }) => {
		const trigger = page.getByRole('button', { name: 'Difficulty: Easy' });
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');

		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('menu', { name: 'Difficulty' })).toBeVisible();
		await expect(page.getByRole('menuitemradio', { name: 'Easy' })).toBeFocused();
		await expect(page.getByRole('menuitemradio', { name: 'Easy' })).toHaveAttribute(
			'aria-checked',
			'true'
		);

		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('menuitemradio', { name: 'Medium' })).toBeFocused();
		await page.keyboard.press('End');
		await expect(page.getByRole('menuitemradio', { name: 'Expert' })).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('menuitemradio', { name: 'Easy' })).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(page.getByRole('menuitemradio', { name: 'Expert' })).toBeFocused();
		await page.keyboard.press('Home');
		await expect(page.getByRole('menuitemradio', { name: 'Easy' })).toBeFocused();
	});

	test('Escape closes it and hands focus back', async ({ page }) => {
		const trigger = page.getByRole('button', { name: 'Difficulty' });
		await trigger.focus();
		await page.keyboard.press('ArrowDown');
		await expect(page.getByRole('menu')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(trigger).toBeFocused();
	});

	test('choosing a setting closes it, hands focus back and renames the button', async ({
		page
	}) => {
		const { sweaterNumber } = await playerOnCard(page);
		await page.getByRole('button', { name: 'Difficulty' }).focus();
		await page.keyboard.press('Enter');
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		await expect(page.getByRole('menu')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Difficulty: Expert' })).toBeFocused();
		// Same card, more answers.
		expect((await playerOnCard(page)).sweaterNumber).toBe(sweaterNumber);
	});

	test('tabbing away closes it', async ({ page }) => {
		await page.getByRole('button', { name: 'Difficulty' }).focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('menu')).toBeVisible();

		await page.keyboard.press('Tab');
		await expect(page.getByRole('menu')).toHaveCount(0);
		// The next control along the nav, not the top of the page.
		await expect(page.getByRole('link', { name: 'en', exact: true })).toBeFocused();
	});
});

test.describe('the roster drawer', () => {
	test('its toggle is named by the words on it and reports its state', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(GAME_PATH);
		await expect(drawnCard(page)).toBeVisible();

		const show = page.getByRole('button', { name: 'show all', exact: true });
		await expect(show).toHaveAttribute('aria-expanded', 'false');
		await show.click();

		const hide = page.getByRole('button', { name: 'hide roster', exact: true });
		await expect(hide).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByRole('heading', { name: 'Forwards' })).toBeVisible();
		// Every player on the roster, in lists a screen reader can count.
		await expect(page.getByRole('listitem')).toHaveCount(FIXTURE_PLAYERS.length);
	});
});

test.describe('getting around the page', () => {
	test('the first Tab stop skips past the nav', async ({ page }) => {
		await page.goto('/');

		await page.keyboard.press('Tab');
		const skip = page.getByRole('link', { name: 'Skip to content' });
		await expect(skip).toBeFocused();
		await expect(skip).toBeInViewport();

		await page.keyboard.press('Enter');
		await expect(page.locator('#content')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.getByRole('link', { name: 'NHL', exact: true })).toBeFocused();
	});

	test('the two navigation landmarks can be told apart', async ({ page }) => {
		await page.goto('/');
		await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Footer' })).toBeVisible();
	});

	test('a team tile is named once, by its text', async ({ page }) => {
		await page.goto('/');
		await expect(
			page.getByRole('link', { name: 'Toronto Maple Leafs', exact: true })
		).toBeVisible();
	});
});

test.describe('when there is no game to play', () => {
	test('a roster without a single number says so instead of opening on the summary', async ({
		page
	}) => {
		await page.goto(`/game/${NUMBERLESS_TEAM.league}/${NUMBERLESS_TEAM.code}`);

		await expect(page.getByText("The roster isn't available right now.")).toBeVisible();
		await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
		await expect(page.getByText('Congratulations!')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Play Again' })).toHaveCount(0);
	});

	test.describe('with scripts off', () => {
		test.use({ javaScriptEnabled: false });

		test('the undealt deck explains itself', async ({ page }) => {
			// The roster is in the page as served, but the cards are only ever
			// dealt by a script.
			await page.goto(GAME_PATH);
			// By selector, not by text: Playwright's text matching looks past
			// <noscript> whether or not scripts are on.
			await expect(page.locator('noscript p')).toHaveCount(1);
			expect(await page.locator('noscript p').textContent()).toContain(
				'Numbrrs needs JavaScript to deal the cards.'
			);
		});
	});
});

test.describe('one address per team', () => {
	test('another casing of the team code redirects to the stored one', async ({ request }) => {
		const response = await request.get('/game/nhl/tor', { maxRedirects: 0 });
		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe('/game/nhl/TOR');
	});

	test('the redirect keeps the language prefix and the query string', async ({ request }) => {
		const response = await request.get('/fr/game/nhl/Tor?from=share', { maxRedirects: 0 });
		expect(response.status()).toBe(308);
		expect(response.headers().location).toBe('/fr/game/nhl/TOR?from=share');
	});

	test('a code that matches no team is a 404 in any casing', async ({ request }) => {
		const response = await request.get('/game/nhl/zzz', { maxRedirects: 0 });
		expect(response.status()).toBe(404);
	});

	test('a team page names itself as canonical; an error page names nothing', async ({
		request
	}) => {
		const team = await (await request.get(GAME_PATH)).text();
		expect(team).toContain('rel="canonical"');
		expect(team).toContain('rel="alternate"');

		const missing = await (await request.get('/game/nhl/ZZZ')).text();
		expect(missing).not.toContain('rel="canonical"');
		expect(missing).not.toContain('rel="alternate"');
	});
});
