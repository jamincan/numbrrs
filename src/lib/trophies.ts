/**
 * The trophies a player wins for a whole league: drawings, not likenesses.
 *
 * Each is an original drawing. None is traced from, or meant to pass for, the
 * real trophy or anybody else's drawing of it; the names belong to the leagues.
 *
 * A finished one is a solid silhouette in a pale silver grey, which is what
 * these trophies are made of, with its detail cut out of it as fine lines that
 * show whatever is behind: the bands of a barrel, the rings of a collar. Gold
 * is left to the medals. A trophy is shown large enough to be looked at (in
 * the site's header, on the board at the end of a game), and a real one is
 * tall, so these are on a grid 24 wide and 48 tall. One that is broader for
 * its height has a wider grid, and is shown at the same height as the rest.
 *
 * Each path is a shape to fill and a line to cut along its edge, in the order
 * given. A path of a single line has nothing to fill, and only cuts. A few
 * parts are too fine to be shapes, a handle or a hockey stick, and are drawn
 * as a line of silver instead.
 *
 * The ones marked as line drawings, on a 24 by 24 grid, are first drafts
 * waiting to be redrawn this way.
 *
 * Kept as data rather than markup so that anything can draw one: the
 * component in components/Trophy.svelte, and a contact sheet for looking at
 * them side by side.
 */

import type { Locale } from '#lib/i18n/index.ts';
import type { LeagueId } from '#lib/leagues.ts';

export type TrophyId = 'stanley' | 'walter' | 'chynoweth' | 'robertson' | 'courteau' | 'memorial';

export interface TrophyDrawing {
	/** How wide the grid is: 24 unless it says so. */
	width?: number;
	/** And how tall. */
	height: 24 | 48;
	/** A filled shape with its detail cut out of it, or an outline in lines. */
	style: 'solid' | 'line';
	/** In grid units: the width of the cuts in a solid drawing, or of the
	 *  lines in a line drawing. */
	stroke: number;
	/** Each shape, drawn in order. */
	paths: readonly TrophyPath[];
}

/**
 * One shape of a drawing. Almost all are a bare path: silver, with a line cut
 * along its edge. The few that are not say how they differ.
 *
 * `tone` is for a part made of something other than silver. A trophy's base
 * is often wood, and where the shape of that base is what tells the trophy
 * apart, it has to look like one.
 *
 * `flat` is for a shape laid on another with no cut round it: a name plate on
 * the face of a plinth, which a cut would leave floating in a dark outline,
 * or a part too slight to lose half a line's width from each side, like a
 * handle or the knob on a lid.
 *
 * `thick` makes it a line this thick, with round ends, in place of a shape:
 * nothing is filled and nothing is cut.
 */
export type TrophyPath = string | { d: string; tone?: Tone; flat?: true; thick?: number };

/** What a part is made of, where that is not silver. */
export type Tone = 'wood' | 'ebony';

/**
 * The colour of each. Wood is warmer and lighter than the wood itself, so
 * that it can be told from the dark page it is shown on. Ebony is as dark as
 * it can be and still be seen there: it is a ledge between silver parts, and
 * is meant to read as their shadow more than as a colour of its own.
 */
export const TONES: Record<Tone, string> = { wood: '#8f5a3a', ebony: '#3d2b23' };

/** A path, spelled out. */
export function shapeOf(path: TrophyPath): {
	d: string;
	tone: Tone | null;
	cut: boolean;
	thick: number | null;
} {
	if (typeof path === 'string') return { d: path, tone: null, cut: true, thick: null };
	return {
		d: path.d,
		tone: path.tone ?? null,
		cut: !path.flat && !path.thick,
		thick: path.thick ?? null
	};
}

const wood = (d: string): TrophyPath => ({ d, tone: 'wood' });
const flat = (d: string): TrophyPath => ({ d, flat: true });
/** A name plate: silver, laid flat on the wood. */
const plate = flat;
/** A thin dark part laid over the edges of the silver it lies between. */
const ebony = (d: string): TrophyPath => ({ d, tone: 'ebony', flat: true });
/** A part made of ebony, with its edge cut like any other. */
const block = (d: string): TrophyPath => ({ d, tone: 'ebony' });
/** A line of silver, this thick. */
const line = (d: string, thick: number): TrophyPath => ({ d, thick });
/** A name plate in the shape of a shield, from its top left corner: flat
 *  across the top, straight a little way down each side, then in to a point. */
const shield = (x: number, y: number): TrophyPath =>
	flat(`M${x} ${y}h2.8v1.1c0 .7-.3 1.2-1.4 1.9c-1.1-.7-1.4-1.2-1.4-1.9z`);

export const TROPHIES: Record<TrophyId, TrophyDrawing> = {
	// The one everybody knows by its outline, top to bottom: a deep bowl with
	// straight sides, a short neck, a collar of three rings that step outward,
	// round shoulders, a barrel of five bands, and a base that flares.
	stanley: {
		height: 48,
		style: 'solid',
		stroke: 1.1,
		paths: [
			// Bowl
			'M6.25 2.5h11.5v2.25c0 2.6-1.6 4.2-4 4.75h-3.5c-2.4-.55-4-2.15-4-4.75z',
			// Neck: a closed shape like the rest, so that the drawing can be
			// filled without a gap here. Its top and bottom lie along lines that
			// are drawn anyway.
			'M10.25 9.5h3.5v1.75h-3.5z',
			// Collar
			'M9 11.25h6v2.5H9z',
			'M8 13.75h8v2.5H8z',
			'M7 16.25h10v2.5H7z',
			// Shoulders and barrel
			'M7 18.75c-1.75.5-2.5 1.6-2.5 3.25v18.5h15V22c0-1.65-.75-2.75-2.5-3.25',
			// Bands
			'M4.5 25.75h15',
			'M4.5 29.5h15',
			'M4.5 33.25h15',
			'M4.5 37h15',
			// Base
			'M4.5 40.5 2.75 43.5v2h18.5v-2L19.5 40.5'
		]
	},
	// A V. Two hockey sticks stand on their blades, shafts splayed to the top
	// corners: each is narrow at its tip and broad lower down, and at the foot
	// kicks outward where the blade lies along the base. The V between them
	// comes to its point a hair below where the feet begin to kick out, and
	// from there down the two are joined. A shallow bowl sits high between them: a
	// band with flat sides that taper in, then a dish beneath it. The base is
	// one tier, spreading outward on the line the feet set.
	walter: {
		height: 48,
		style: 'solid',
		stroke: 1.1,
		paths: [
			// Both sticks, as the one piece they are: left tip, down the inside to
			// the point of the V and up to the right tip, down the outside to
			// where the foot kicks out, along the bottom, and back up the left
			'M1.75 2.5h2L12 36l8.25-33.5h2L18 35l1.75 4.25H4.25L6 35z',
			// Bowl, in one piece: flat sides, steep, tapering in from the rim, then the
			// dish. Its rim just reaches the sticks.
			'M4.75 6.5h14.5L18.25 10c-.6 2.1-2.9 3.25-6.25 3.25S6.35 12.1 5.75 10z',
			// Base
			'M4.25 39.25h15.5l2.6 5a.9.9 0 0 1-.8 1.25H2.45a.9.9 0 0 1-.8-1.25z'
		]
	},
	// A round bowl whose lip flares out almost flat, its edge gently scalloped
	// like an open flower. It narrows to a neck and spreads again into a foot.
	// Under it, more base than cup, and in wood: a block, then four tiers of a
	// six-sided plinth, each wider than the last. Every tier carries silver
	// name plates, a broad one on the face in front and a sliver on each of
	// the two faces that angle away, which is what shows it has six sides.
	chynoweth: {
		height: 48,
		style: 'solid',
		stroke: 1.1,
		paths: [
			// Bowl: five shallow scallops along the lip, then each side in one
			// sweep, in under the lip, out round the belly and in to the neck
			'M3.5 4.75q1.7-1.2 3.4 0q1.7-1.2 3.4 0q1.7-1.2 3.4 0q1.7-1.2 3.4 0q1.7-1.2 3.4 0c-4 .5-3 5.75-6.5 6.25h-4c-3.5-.5-2.5-5.75-6.5-6.25z',
			// Neck and foot
			'M10.25 11h3.5v2h-3.5z',
			'M10 13h4l2.25 3h-8.5z',
			// Block
			wood('M8 16h8v3.25H8z'),
			// Four tiers, each with its plates
			wood('M6.25 19.25h11.5v6H6.25z'),
			plate('M9.5 20.6h5v3.3h-5z'),
			plate('M7.4 20.6h1v3.3h-1z'),
			plate('M15.6 20.6h1v3.3h-1z'),
			wood('M5.5 25.25h13v6.25h-13z'),
			plate('M9.3 26.6h5.4v3.55H9.3z'),
			plate('M6.65 26.6h1.5v3.55h-1.5z'),
			plate('M15.85 26.6h1.5v3.55h-1.5z'),
			wood('M4.75 31.5h14.5v6.25H4.75z'),
			plate('M8.9 32.85h6.2v3.55H8.9z'),
			plate('M5.9 32.85h1.85v3.55H5.9z'),
			plate('M16.25 32.85h1.85v3.55h-1.85z'),
			wood('M3.75 37.75h16.5v7.75H3.75z'),
			plate('M8.4 39.1h7.2v5.05H8.4z'),
			plate('M4.9 39.1h2.35v5.05H4.9z'),
			plate('M16.75 39.1h2.35v5.05h-2.35z')
		]
	},
	// A tall cup with a lid, on a round wooden base as tall as itself. The cup
	// is narrow for its height and tapers all the way down; its domed lid ends
	// in a knob, and a thin handle like an ear stands out from each side, from
	// just under the rim to low on the body. A short stem and a spreading foot,
	// then the base, turned from wood: a collar, a drum, and a plinth that
	// flares out to the widest part of the whole trophy. Rows of small silver
	// plates go round the collar and the drum. The ones at the sides are drawn
	// narrower, as they look where the drum curves away.
	robertson: {
		height: 48,
		style: 'solid',
		stroke: 1.1,
		paths: [
			// Lid, and the knob on it
			'M7.75 8.25c0-2.2 1.6-3.5 4.25-3.5s4.25 1.3 4.25 3.5z',
			flat(
				'M12 1.75a1.2 1.2 0 0 1 1.2 1.2c0 .8-.55 1.05-.55 2.3h-1.3c0-1.25-.55-1.5-.55-2.3a1.2 1.2 0 0 1 1.2-1.2z'
			),
			// Body
			'M7.5 8.25h9c0 5-1.5 9-3 11h-3c-1.5-2-3-6-3-11z',
			// Handles, each a band from the body out, round and back, laid over
			// the body's edge so that they join it
			flat(
				'M8.1 9.25C6.2 8 4.5 8.9 4.5 10.9C4.5 13.3 6.8 15.7 10 17.1L10 15.85C7.5 14.7 5.75 12.8 5.75 10.9C5.75 9.9 6.7 9.6 8.1 10.5z'
			),
			flat(
				'M15.9 9.25C17.8 8 19.5 8.9 19.5 10.9C19.5 13.3 17.2 15.7 14 17.1L14 15.85C16.5 14.7 18.25 12.8 18.25 10.9C18.25 9.9 17.3 9.6 15.9 10.5z'
			),
			// Stem and foot
			'M10.5 19.25h3v2.25h-3z',
			'M10.25 21.5h3.5l2 2.75h-7.5z',
			// Collar, with its band of plates
			wood('M8 24.25h8v5.25H8z'),
			plate('M9.2 25.75h1.4v2.25H9.2z'),
			plate('M11.1 25.75h1.8v2.25h-1.8z'),
			plate('M13.4 25.75h1.4v2.25h-1.4z'),
			// Drum, with four rows of them
			wood('M7 29.5h10v11H7z'),
			plate('M8.1 30.5h1.8v1.8H8.1z'),
			plate('M10.5 30.5h3v1.8h-3z'),
			plate('M14.1 30.5h1.8v1.8h-1.8z'),
			plate('M8.1 32.9h1.8v1.8H8.1z'),
			plate('M10.5 32.9h3v1.8h-3z'),
			plate('M14.1 32.9h1.8v1.8h-1.8z'),
			plate('M8.1 35.3h1.8v1.8H8.1z'),
			plate('M10.5 35.3h3v1.8h-3z'),
			plate('M14.1 35.3h1.8v1.8h-1.8z'),
			plate('M8.1 37.7h1.8v1.8H8.1z'),
			plate('M10.5 37.7h3v1.8h-3z'),
			plate('M14.1 37.7h1.8v1.8h-1.8z'),
			// Plinth
			wood('M7 40.5h10c0 1.9.9 3.1 2 3.4v1.6H5v-1.6c1.1-.3 2-1.5 2-3.4z')
		]
	},
	// A stack of silver drums, each wider than the one above, with a bowl on
	// top: a silver trophy all the way down, where the two before it stand on
	// wood. A round bowl on a small foot; a plain drum; a taller one of five
	// bands; a broad one whose face is a single plate, seamed at either side;
	// and the broadest, of three bands. Each drum is capped with a thin disc of
	// ebony that shows as a dark ledge round the foot of the one above, and the
	// whole stands on one more, thicker and wider than the rest.
	courteau: {
		height: 48,
		style: 'solid',
		stroke: 0.8,
		paths: [
			// Bowl, and the foot it stands on, laid over the bowl's edge so that
			// the two are one piece
			'M6.25 2.5h11.5c0 3.6-2.2 5.75-4.25 5.75h-3c-2.05 0-4.25-2.15-4.25-5.75z',
			flat('M10.75 7.9h2.5l1.5 2.35h-5.5z'),
			// The drums, top to bottom, each with the lines that divide it. The
			// last runs on under the base, which hides its bottom edge
			'M8.5 10.25h7v5.25h-7z',
			'M7 15.5h10v12.75H7z',
			'M7 18.4h10',
			'M7 20.85h10',
			'M7 23.3h10',
			'M7 25.8h10',
			'M5.75 28.25h12.5v6H5.75z',
			'M8.75 28.25v6',
			'M15.25 28.25v6',
			'M4.75 34.25h14.5v9.15H4.75z',
			'M4.75 37.6h14.5',
			'M4.75 40.5h14.5',
			// The ebony: a cap on each drum, laid over its top edge, and the base
			ebony('M8.5 10.25h7v.85h-7z'),
			ebony('M7 15.5h10v.85H7z'),
			ebony('M5.75 28.25h12.5v.85H5.75z'),
			ebony('M4.75 34.25h14.5v.85H4.75z'),
			ebony('M3.75 43h16.5v1.5a1 1 0 0 1-1 1H4.75a1 1 0 0 1-1-1z')
		]
	},
	// The widest of them, and the most ornate. A deep cup with a plain rim and
	// a handle at each side that swoops out above the rim, in to the body and
	// out again in an S. It stands on a slender stem and a spreading foot,
	// on a round drum of ebony. Under that, a broad ebony base in two tiers,
	// whose front swells forward in the middle: the ledge between the tiers
	// dips there, and the rows of plates dip with it. Every plate is a silver
	// shield. On each end of the base a silver hockey player stands on a small
	// pedestal, facing in, stick on the ice.
	memorial: {
		width: 36,
		height: 48,
		style: 'solid',
		stroke: 0.8,
		paths: [
			// Base: the lower tier, the upper one over it, and the drum
			block('M1.75 35.8h32.5v9.7H1.75z'),
			block('M3 27.6h30v8.2h-5c-3.5 0-5.5 1.1-10 1.1s-6.5-1.1-10-1.1H3z'),
			block('M11.75 27.6V24a1 1 0 0 1 1-1h10.5a1 1 0 0 1 1 1v3.6z'),
			// Shields: three on the drum, then two rows on each tier
			shield(12.9, 23.9),
			shield(16.6, 23.9),
			shield(20.3, 23.9),
			shield(4.3, 28.4),
			shield(8.4, 28.4),
			shield(12.5, 28.8),
			shield(16.6, 28.9),
			shield(20.7, 28.8),
			shield(24.8, 28.4),
			shield(28.9, 28.4),
			shield(4.3, 32),
			shield(8.4, 32.1),
			shield(12.5, 32.7),
			shield(16.6, 33),
			shield(20.7, 32.7),
			shield(24.8, 32.1),
			shield(28.9, 32),
			shield(3.4, 37.2),
			shield(7.8, 37.3),
			shield(12.2, 37.7),
			shield(16.6, 37.9),
			shield(21, 37.7),
			shield(25.4, 37.3),
			shield(29.8, 37.2),
			shield(3.4, 41.5),
			shield(7.8, 41.5),
			shield(12.2, 41.7),
			shield(16.6, 41.8),
			shield(21, 41.7),
			shield(25.4, 41.5),
			shield(29.8, 41.5),
			// Cup: a plain rim, then in under the lip, down a side that is nearly
			// straight, and round to the bottom
			'M12.2 3.6h11.6c-.6.4-.75.9-.7 1.6l-.3 5.2c-.25 2.6-1.4 4.1-3.2 4.4h-3.2c-1.8-.3-2.95-1.8-3.2-4.4l-.3-5.2c.05-.7-.1-1.2-.7-1.6z',
			// Stem and foot, in one sweep
			'M16.6 14.8h2.8c0 1.2-.4 2-.4 3.4c.3 2 2.2 2.9 4.4 3.3V23H12.6v-1.5c2.2-.4 4.1-1.3 4.4-3.3c0-1.4-.4-2.2-.4-3.4z',
			// Handles
			line(
				'M12.8 5.8C12.2 4.5 11 3.1 9.5 3.2C8 3.3 7.4 4.9 8 6.4C8.8 8.6 12.2 9 13.3 10.7C14.1 11.9 13.5 13.3 11.9 13',
				1
			),
			line(
				'M23.2 5.8C23.8 4.5 25 3.1 26.5 3.2C28 3.3 28.6 4.9 28 6.4C27.2 8.6 23.8 9 22.7 10.7C21.9 11.9 22.5 13.3 24.1 13',
				1
			),
			// The player on the left: pedestal, legs, body, head, arms, stick
			flat('M4.7 26.5h3.8v1.1H4.7z'),
			line('M6.2 23.4L5.2 26.2', 1),
			line('M6.3 23.4L7.3 24.9L7.2 26.2', 1),
			line('M6.9 21.2L6.2 23.3', 1.8),
			flat('M7.3 19a.8.8 0 0 1 0 1.6a.8.8 0 0 1 0-1.6z'),
			line('M7 21.4L8.3 22.3L8.9 23.4', 0.9),
			line('M8.4 22.6L10.6 26.2h.9', 0.65),
			// And the one on the right, the same turned round
			flat('M27.5 26.5h3.8v1.1h-3.8z'),
			line('M29.8 23.4L30.8 26.2', 1),
			line('M29.7 23.4L28.7 24.9L28.8 26.2', 1),
			line('M29.1 21.2L29.8 23.3', 1.8),
			flat('M28.7 19a.8.8 0 0 1 0 1.6a.8.8 0 0 1 0-1.6z'),
			line('M29 21.4L27.7 22.3L27.1 23.4', 0.9),
			line('M27.6 22.6L25.4 26.2h-.9', 0.65)
		]
	}
};

/** The trophy for winning each league. */
export const LEAGUE_TROPHY: Record<LeagueId, TrophyId> = {
	nhl: 'stanley',
	pwhl: 'walter',
	whl: 'chynoweth',
	ohl: 'robertson',
	qmjhl: 'courteau'
};

/** The leagues that have to be won together for the Memorial Cup. */
export const MEMORIAL_LEAGUES: readonly LeagueId[] = ['whl', 'ohl', 'qmjhl'];

/** The three junior trophies, west to east. */
const JUNIOR: readonly TrophyId[] = ['chynoweth', 'robertson', 'courteau'];

/**
 * Every trophy, in the order they stand in, left to right: the two
 * professional ones, the Memorial Cup, and then the three it is won through.
 * Those three run west to east in English and east to west in French;
 * Ontario's is in the middle either way.
 */
export function trophyOrder(locale: Locale): readonly TrophyId[] {
	const junior = locale === 'fr' ? [...JUNIOR].reverse() : JUNIOR;
	return ['stanley', 'walter', 'memorial', ...junior];
}

/**
 * The trophies somebody holds, in that order, given which leagues they have
 * won: one for each league, and the Memorial Cup for all three junior leagues
 * at once.
 */
export function trophiesHeld(won: (league: LeagueId) => boolean, locale: Locale): TrophyId[] {
	const leagues = Object.keys(LEAGUE_TROPHY) as LeagueId[];
	return trophyOrder(locale).filter((id) =>
		id === 'memorial'
			? MEMORIAL_LEAGUES.every(won)
			: leagues.some((league) => LEAGUE_TROPHY[league] === id && won(league))
	);
}
