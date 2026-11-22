import { describe, expect, it } from 'vitest';
import { LEAGUE_IDS } from './leagues';
import {
	LEAGUE_TROPHY,
	MEMORIAL_LEAGUES,
	shapeOf,
	trophiesHeld,
	trophyOrder,
	TROPHIES,
	type TrophyId
} from './trophies';

describe('trophies', () => {
	const ids = Object.keys(TROPHIES) as TrophyId[];

	it('has one for every league, each its own, and one more for the three junior leagues together', () => {
		expect(Object.keys(LEAGUE_TROPHY).sort()).toEqual([...LEAGUE_IDS].sort());
		const awarded = Object.values(LEAGUE_TROPHY);
		expect(new Set(awarded).size).toBe(awarded.length);
		expect(awarded).not.toContain('memorial');
		expect([...awarded, 'memorial'].sort()).toEqual([...ids].sort());
		expect([...MEMORIAL_LEAGUES].sort()).toEqual(['ohl', 'qmjhl', 'whl']);
	});

	it.each(ids)('draws %s as shapes that stay on its grid', (id) => {
		const { width = 24, height, style, stroke } = TROPHIES[id];
		const paths = TROPHIES[id].paths.map((path) => shapeOf(path).d);
		expect([24, 48]).toContain(height);
		// A finished drawing is solid, on the tall grid; a draft is neither.
		expect(style).toBe(height === 48 ? 'solid' : 'line');
		expect(stroke).toBeGreaterThan(0);
		expect(paths.length).toBeGreaterThanOrEqual(3);
		// No two the same: the component keys them by their path.
		expect(new Set(paths).size).toBe(paths.length);
		for (const d of paths) {
			// Path commands and numbers, nothing else, starting with a move.
			expect(d).toMatch(/^M[\d\s.,MmLlHhVvCcSsQqTtAaZz-]+$/);
			// Every shape starts inside the grid, half a line's width in.
			const start = /^M\s*([\d.]+)[\s,]+([\d.]+)/.exec(d);
			expect(start).not.toBeNull();
			const [x, y] = [Number(start?.[1]), Number(start?.[2])];
			expect(x).toBeGreaterThanOrEqual(stroke / 2);
			expect(x).toBeLessThanOrEqual(width - stroke / 2);
			expect(y).toBeGreaterThanOrEqual(stroke / 2);
			expect(y).toBeLessThanOrEqual(height - stroke / 2);
		}
	});

	it('says how a shape differs from plain silver with a cut edge, and only then', () => {
		expect(shapeOf('M1 1h2')).toEqual({ d: 'M1 1h2', tone: null, cut: true, thick: null });
		expect(shapeOf({ d: 'M1 1h2', tone: 'wood' })).toEqual({
			d: 'M1 1h2',
			tone: 'wood',
			cut: true,
			thick: null
		});
		expect(shapeOf({ d: 'M1 1h2', flat: true })).toEqual({
			d: 'M1 1h2',
			tone: null,
			cut: false,
			thick: null
		});
	});

	it('draws the Stanley Cup with its five bands', () => {
		// Four lines across the barrel make five bands of it.
		const bands = TROPHIES.stanley.paths
			.map((path) => shapeOf(path).d)
			.filter((d) => /^M4\.5 [\d.]+h15$/.test(d));
		expect(bands).toHaveLength(4);
	});

	it('gives the Ed Chynoweth Cup a wooden base of four tiers, each with three plates', () => {
		const shapes = TROPHIES.chynoweth.paths.map(shapeOf);
		// A block and four tiers, in wood.
		expect(shapes.filter((shape) => shape.tone === 'wood')).toHaveLength(5);
		// Plates lie flat on the wood, with no cut round them.
		expect(shapes.filter((shape) => !shape.cut)).toHaveLength(12);
		expect(shapes.some((shape) => shape.tone === 'wood' && !shape.cut)).toBe(false);
	});

	it('gives the J. Ross Robertson Cup handles, and a round wooden base covered in plates', () => {
		const shapes = TROPHIES.robertson.paths.map(shapeOf);
		// A collar, a drum and a plinth, in wood.
		expect(shapes.filter((shape) => shape.tone === 'wood')).toHaveLength(3);
		// One row of three plates on the collar and four on the drum, and the
		// knob and two handles, which are too slight to have a line cut round them.
		expect(shapes.filter((shape) => !shape.cut)).toHaveLength(15 + 3);
		expect(shapes.some((shape) => shape.tone === 'wood' && !shape.cut)).toBe(false);
	});

	it('makes the Gilles-Courteau Trophy of silver, with only thin caps and a base in ebony', () => {
		const shapes = TROPHIES.courteau.paths.map(shapeOf);
		expect(shapes.some((shape) => shape.tone === 'wood')).toBe(false);
		// A cap on each of the four drums, and the base, all laid flat.
		const dark = shapes.filter((shape) => shape.tone === 'ebony');
		expect(dark).toHaveLength(5);
		expect(dark.every((shape) => !shape.cut)).toBe(true);
		// Five bands on the tall drum and three on the bottom one.
		const lines = shapes.filter((shape) => /^M[0-9.]+ [0-9.]+h[0-9.]+$/.test(shape.d));
		expect(lines).toHaveLength(4 + 2);
	});

	it('draws a line of silver as a line, with nothing cut round it', () => {
		expect(shapeOf({ d: 'M1 1h2', thick: 0.5 })).toEqual({
			d: 'M1 1h2',
			tone: null,
			cut: false,
			thick: 0.5
		});
	});

	it('gives the Memorial Cup an ebony base covered in shields, two handles and two players', () => {
		const shapes = TROPHIES.memorial.paths.map(shapeOf);
		expect(TROPHIES.memorial.width).toBeGreaterThan(24);
		// Two tiers and a drum.
		expect(shapes.filter((shape) => shape.tone === 'ebony')).toHaveLength(3);
		expect(shapes.some((shape) => shape.tone === 'wood')).toBe(false);
		// Three shields on the drum and two rows of seven on each tier, every
		// one the same shape.
		const shields = shapes.filter((shape) => shape.d.endsWith('c-1.1-.7-1.4-1.2-1.4-1.9z'));
		expect(shields).toHaveLength(3 + 4 * 7);
		expect(shields.every((shape) => !shape.cut && !shape.tone)).toBe(true);
		// A handle each side, and for each player two legs, a body, arms and a stick.
		expect(shapes.filter((shape) => shape.thick)).toHaveLength(2 + 2 * 5);
	});

	it('keeps the all-silver trophies all silver', () => {
		for (const id of ['stanley', 'walter'] as const) {
			expect(TROPHIES[id].paths.every((path) => typeof path === 'string')).toBe(true);
		}
	});

	it('stands them in one order in English and another in French', () => {
		expect(trophyOrder('en')).toEqual([
			'stanley',
			'walter',
			'memorial',
			'chynoweth',
			'robertson',
			'courteau'
		]);
		// The three junior ones the other way round, Ontario's still between.
		expect(trophyOrder('fr')).toEqual([
			'stanley',
			'walter',
			'memorial',
			'courteau',
			'robertson',
			'chynoweth'
		]);
		for (const locale of ['en', 'fr'] as const) {
			expect([...trophyOrder(locale)].sort()).toEqual([...ids].sort());
		}
	});

	it('gives a trophy for each league won, in that order', () => {
		const won =
			(...leagues: string[]) =>
			(league: string) =>
				leagues.includes(league);
		expect(trophiesHeld(won(), 'en')).toEqual([]);
		expect(trophiesHeld(won('pwhl'), 'en')).toEqual(['walter']);
		expect(trophiesHeld(won('qmjhl', 'nhl', 'whl'), 'en')).toEqual([
			'stanley',
			'chynoweth',
			'courteau'
		]);
		expect(trophiesHeld(won('qmjhl', 'nhl', 'whl'), 'fr')).toEqual([
			'stanley',
			'courteau',
			'chynoweth'
		]);
	});

	it('gives the Memorial Cup for all three junior leagues, and nothing less', () => {
		const won =
			(...leagues: string[]) =>
			(league: string) =>
				leagues.includes(league);
		expect(trophiesHeld(won('whl', 'ohl'), 'en')).not.toContain('memorial');
		expect(trophiesHeld(won('nhl', 'pwhl', 'ohl', 'qmjhl'), 'en')).not.toContain('memorial');
		expect(trophiesHeld(won('whl', 'ohl', 'qmjhl'), 'en')).toEqual([
			'memorial',
			'chynoweth',
			'robertson',
			'courteau'
		]);
		expect(trophiesHeld(won('nhl', 'pwhl', 'whl', 'ohl', 'qmjhl'), 'fr')).toEqual(
			trophyOrder('fr')
		);
	});
});
