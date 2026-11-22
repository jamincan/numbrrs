/**
 * Usage: `node scripts/contrast-check.mjs [--root <dir>] [--verbose]`
 *
 * Computes the WCAG 2.2 contrast ratio of the text the site draws over a
 * colour, for every team with a palette, and exits non-zero if any pair is
 * under its threshold: 4.5:1 for text, 3:1 for large text (24px and up, or
 * 18.66px and up in bold) and for the boundary of a control.
 *
 * Nothing is rendered. The colours come from src/lib/team-colors.ts, the
 * classes and sizes are read out of the components that use them, and Tailwind's
 * palette is read from its own theme file, so a change to any of those is
 * measured the next time this runs. src/lib/contrast.test.ts runs it with the
 * unit suite. `--root` points it at another checkout to compare against;
 * `--verbose` lists every failing team rather than the worst three.
 *
 * Text on a card sits over a gradient, so each line is measured at the point
 * of the gradient where it fares worst. Where that is depends on the size of
 * the card: the type has a floor, so on a small card the lines are taller and
 * wrap, and the stack they form spreads further up and down the card. The
 * model below lays the card out at every width it can have and takes the worst
 * point across them all.
 *
 * Two things a computation cannot see are stated rather than guessed at:
 *
 * - The team logo sits behind the text as a watermark. On the front its
 *   opacity is treated as that much pure white under the text, the worst it
 *   could be. On the back it is left out of the verdict and reported beside
 *   it, because what it does there depends on the artwork: see
 *   `watermarkNote` in the output.
 * - The shadow under the big number is ignored. It can only help.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TEXT = 4.5;
const LARGE = 3;
/** WCAG's "large scale": 18pt, or 14pt bold. */
const LARGE_PX = 24;
const LARGE_BOLD_PX = 18.66;

const REM = 16;
/** The card is 3:4, so every length on it can be given in hundredths of its width. */
const CARD_HEIGHT = 400 / 3;
/** Two cards and the gap between them across 320 CSS px, the narrowest
 *  viewport WCAG's reflow criterion asks for: the smallest card measured when
 *  the card slot declares no minimum of its own. */
const NARROWEST_CARD_PX = 136;

/**
 * Advance widths measured in Chromium, in em, for the strings that set the
 * worst case: the widest two-digit number in Barlow Condensed 900, and the
 * longest team name and prompt in either language, upper-cased, without their
 * letter-spacing.
 */
const NUMBER_EM = 1.7;
const LONGEST_NAME = { em: 13, chars: 32 };
const LONGEST_PROMPT = { em: 9.6, chars: 22 };
/** A player name long enough to wrap on any card: "Emile-Alexandro Lemieux-Goupil". */
const LONGEST_PLAYER = { em: 12.8, chars: 30 };

// ---------------------------------------------------------------- colour

/** @typedef {[number, number, number]} Rgb sRGB, each channel 0–255. */

/** @param {string} hex @returns {Rgb} */
function parseHex(hex) {
	const h = hex.replace('#', '');
	const full =
		h.length === 3
			? [...h].map((c) => c + c).join('')
			: h.length === 6
				? h
				: (() => {
						throw new Error(`Not a hex colour: ${hex}`);
					})();
	return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

/** @param {number} l 0–1 @param {number} c @param {number} hDeg @returns {Rgb} */
function oklchToRgb(l, c, hDeg) {
	const h = (hDeg * Math.PI) / 180;
	const a = c * Math.cos(h);
	const b = c * Math.sin(h);
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	const linear = [
		4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
		-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
		-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
	];
	return linear.map((v) => {
		const x = Math.min(1, Math.max(0, v));
		return 255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055);
	});
}

/** @param {string} value a CSS colour as Tailwind's theme writes it @returns {Rgb} */
function parseColor(value) {
	const v = value.trim();
	if (v.startsWith('#')) return parseHex(v);
	const oklch = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+|none)\s*\)$/.exec(v);
	if (oklch)
		return oklchToRgb(
			Number(oklch[1]) / (oklch[2] ? 100 : 1),
			Number(oklch[3]),
			oklch[4] === 'none' ? 0 : Number(oklch[4])
		);
	throw new Error(`Cannot read the colour "${value}"`);
}

/** @param {Rgb} rgb */
function luminance(rgb) {
	const [r, g, b] = rgb.map((v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {Rgb} a @param {Rgb} b */
function contrast(a, b) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

/** `top` at `alpha` over `under`, the way a browser composites in sRGB.
 *  @param {Rgb} top @param {number} alpha @param {Rgb} under @returns {Rgb} */
function over(top, alpha, under) {
	return under.map((v, i) => v + (top[i] - v) * alpha);
}

const WHITE = /** @type {Rgb} */ ([255, 255, 255]);
const BLACK = /** @type {Rgb} */ ([0, 0, 0]);

// ---------------------------------------------------------------- sources

/** @param {string} root */
function sources(root) {
	/** @type {Map<string, string>} */
	const cache = new Map();
	/** @param {string} file */
	const read = (file) => {
		let text = cache.get(file);
		if (text === undefined) {
			text = readFileSync(join(root, file), 'utf8');
			cache.set(file, text);
		}
		return text;
	};

	/**
	 * The first capture of `pattern` in `file`. Throws rather than returning
	 * nothing: a pattern that stops matching means the markup moved, and a
	 * check that quietly measures nothing would pass forever.
	 * @param {string} file @param {RegExp} pattern
	 */
	const capture = (file, pattern) => {
		const match = pattern.exec(read(file));
		if (!match || match[1] === undefined)
			throw new Error(
				`${file}: nothing matches ${pattern}. The markup this check reads has changed; update the pattern in scripts/contrast-check.mjs.`
			);
		return match[1];
	};

	/** As `capture`, for something a file may not have. @param {string} file @param {RegExp} pattern */
	const optional = (file, pattern) => pattern.exec(read(file))?.[1];

	return { read, capture, optional };
}

/**
 * Tailwind's palette, with the site's own additions and overrides on top.
 * @param {string} root @param {ReturnType<typeof sources>} src
 */
function palette(root, src) {
	const theme = [REPO, root]
		.map((dir) => join(dir, 'node_modules/tailwindcss/theme.css'))
		.find((file) => existsSync(file));
	if (!theme) throw new Error('tailwindcss/theme.css not found; is node_modules installed?');

	/** @type {Map<string, string>} */
	const colors = new Map();
	for (const css of [readFileSync(theme, 'utf8'), src.read('src/app.css')]) {
		for (const [, name, value] of css.matchAll(/--color-([\w-]+):\s*([^;]+);/g)) {
			if (name && value) colors.set(name, value);
		}
	}

	/**
	 * A colour utility's value, as [colour, alpha].
	 * @param {string} token e.g. `gray-400`, `white/70`
	 * @returns {[Rgb, number]}
	 */
	return (token) => {
		const [name = '', alpha] = token.split('/');
		const value = colors.get(name);
		if (!value) throw new Error(`No colour named "${name}" in the theme`);
		return [parseColor(value), alpha === undefined ? 1 : Number(alpha) / 100];
	};
}

const SIZE_UTILITIES = new Map([
	['xs', 0.75],
	['sm', 0.875],
	['base', 1],
	['lg', 1.125],
	['xl', 1.25],
	['2xl', 1.5],
	['3xl', 1.875]
]);

/**
 * The utility in a class list that sets `prefix`'s colour, skipping the ones
 * that share the prefix but set something else, and anything behind a variant.
 * @param {string} classes @param {'text' | 'bg' | 'border'} prefix
 */
function colorUtility(classes, prefix) {
	const found = classes
		.split(/\s+/)
		.filter((c) => c.startsWith(`${prefix}-`) && !c.includes(':'))
		.map((c) => c.slice(prefix.length + 1))
		.filter((c) => /^(white|black|[a-z]+-\d+|[a-z]+)(\/\d+)?$/.test(c))
		.filter((c) => !SIZE_UTILITIES.has(c) && !['center', 'left', 'right', 'balance'].includes(c));
	return found.at(-1);
}

/**
 * A CSS length in px. `em` is the element's own font size.
 * @param {string} expr e.g. `4.5cqw`, `max(0.75rem,4.5cqw)`
 * @param {number} cardPx the card's width, which is what `cqw` measures
 * @param {number} [em]
 */
function px(expr, cardPx, em = NaN) {
	const js = expr
		.replace(/_/g, ' ')
		.replace(/([\d.]+)cqw/g, (_, n) => `(${n}*${cardPx / 100})`)
		.replace(/([\d.]+)rem/g, (_, n) => `(${n}*${REM})`)
		.replace(/([\d.]+)em/g, (_, n) => `(${n}*${em})`)
		.replace(/([\d.]+)px/g, '$1')
		.replace(/\b(max|min)\(/g, 'Math.$1(');
	if (!/^[\d.\s()*+\-/,Mathmaxin]+$/.test(js)) throw new Error(`Cannot evaluate length "${expr}"`);
	const value = Number(new Function(`return ${js}`)());
	if (!Number.isFinite(value)) throw new Error(`Length "${expr}" did not come to a number`);
	return value;
}

/**
 * What the layout model needs to know about one line of text on a card.
 * @param {string} classes
 */
function textBox(classes) {
	const list = classes.split(/\s+/);
	/** @param {RegExp} pattern */
	const arbitrary = (pattern) => {
		for (const c of list) {
			const m = pattern.exec(c);
			if (m?.[1]) return m[1];
		}
		return undefined;
	};
	const named = list
		.map((c) => /^text-(\w+)$/.exec(c)?.[1])
		.find((n) => n && SIZE_UTILITIES.has(n));
	const size =
		arbitrary(/^text-\[([^\]]*(?:cqw|rem|px)[^\]]*)\]$/) ??
		(named && `${SIZE_UTILITIES.get(named)}rem`);
	if (!size) throw new Error(`No font size in "${classes}"`);
	const leading = list.includes('leading-none')
		? 1
		: Number(arbitrary(/^leading-\[([\d.]+)\]$/) ?? 1.5);
	const weight = list.includes('font-black')
		? 900
		: list.includes('font-bold')
			? 700
			: list.includes('font-semibold')
				? 600
				: 400;
	return {
		size,
		leading,
		weight,
		padBlock: arbitrary(/^py-\[([^\]]+)\]$/) ?? '0px',
		marginTop: arbitrary(/^mt-\[([^\]]+)\]$/) ?? '0px',
		// How far the box reaches into the padding either side of it.
		outdent: arbitrary(/^-mx-\[([^\]]+)\]$/) ?? '0px',
		tracking: list.includes('tracking-widest')
			? '0.1em'
			: (arbitrary(/^tracking-\[([^\]]+)\]$/) ?? '0px')
	};
}

/** @param {number} fontPx @param {number} weight */
function isLarge(fontPx, weight) {
	return fontPx >= LARGE_PX || (weight >= 700 && fontPx >= LARGE_BOLD_PX);
}

// ---------------------------------------------------------------- card layout

/**
 * How many lines the longest string could take in a box this wide. Rounded up
 * generously once it no longer fits on one: words don't break evenly.
 * @param {{ em: number, chars: number }} text @param {number} fontPx
 * @param {number} trackingPx @param {number} widthPx
 */
function linesFor(text, fontPx, trackingPx, widthPx) {
	const need = text.em * fontPx + text.chars * trackingPx;
	if (need <= widthPx) return 1;
	return Math.min(4, Math.ceil((need / widthPx) * 1.6));
}

/**
 * How far along a `linear-gradient(<angle>deg, …)` a point of the card is, 0
 * at the first stop. Coordinates in hundredths of the card's width.
 * @param {number} angleDeg @param {number} x @param {number} y
 */
function gradientAt(angleDeg, x, y) {
	const a = (angleDeg * Math.PI) / 180;
	const dx = Math.sin(a);
	const dy = -Math.cos(a);
	const length = Math.abs(100 * dx) + Math.abs(CARD_HEIGHT * dy);
	const t = 0.5 + ((x - 50) * dx + (y - CARD_HEIGHT / 2) * dy) / length;
	return Math.min(1, Math.max(0, t));
}

/** @typedef {{ lead: number, height: number, width: number }} Box px; `lead` is the margin above it. */

/**
 * Lays out a card face — a centred column — at every width the card can have,
 * and reports, per line of it, the earliest point of the gradient its box
 * reaches and the smallest it is ever drawn.
 *
 * @param {object} face
 * @param {number} face.angle
 * @param {[number, number]} face.widths narrowest and widest card, px
 * @param {string} face.padding the column's own padding
 * @param {string} face.gap
 * @param {(cardPx: number) => { key: string, variants: Box[] }[]} face.rows
 *   Each row's possible boxes at that card width.
 */
function layOut(face) {
	/** @type {Map<string, number>} */
	const earliest = new Map();
	for (let cardPx = face.widths[0]; cardPx <= face.widths[1]; cardPx += 2) {
		const unit = cardPx / 100;
		const gap = px(face.gap, cardPx);
		const rows = face.rows(cardPx);

		// Every combination of the rows' variants.
		/** @type {Box[][]} */
		let combos = [[]];
		for (const row of rows) combos = combos.flatMap((c) => row.variants.map((v) => [...c, v]));

		for (const combo of combos) {
			const total =
				combo.reduce((sum, box) => sum + box.lead + box.height, 0) + gap * (combo.length - 1);
			let y = (cardPx * CARD_HEIGHT) / 100 / 2 - total / 2;
			combo.forEach((box, i) => {
				const row = rows[i];
				if (!row) return;
				// The top-left corner is the lightest point of a box on a gradient
				// that runs down and to the right.
				const t = gradientAt(face.angle, 50 - box.width / unit / 2, (y + box.lead) / unit);
				earliest.set(row.key, Math.min(earliest.get(row.key) ?? 1, t));
				y += box.lead + box.height + gap;
			});
		}
	}
	return earliest;
}

// ---------------------------------------------------------------- the audit

/**
 * @typedef {object} Pair
 * @property {string} id
 * @property {string} what
 * @property {number} threshold
 * @property {{ team: string, ratio: number }[]} results one per team, or one in all for a pair no team colours
 * @property {string} [note]
 */

/**
 * @param {string} [root] the checkout to read
 * @returns {Promise<{ pairs: Pair[], failures: number, outgrown: string[], watermarkNote: string, stops: Record<string, number> }>}
 */
export async function audit(root = REPO) {
	const src = sources(root);
	const color = palette(root, src);

	const teamColors = await import(pathToFileURL(join(root, 'src/lib/team-colors.ts')).href);
	/** @type {string[]} */
	const ids = teamColors.TEAM_IDS;
	if (!Array.isArray(ids) || ids.length === 0)
		throw new Error('src/lib/team-colors.ts exports no TEAM_IDS to walk');
	/** @type {{ id: string, colors: any }[]} */
	const teams = ids.map((id) => {
		const [league = '', code = ''] = id.split(':');
		return { id, colors: teamColors.getTeamColors(league, code) };
	});
	// A team with no palette gets the fallback, which has to read as well.
	teams.push({ id: '(no palette)', colors: teamColors.getTeamColors('nhl', '\u0000') });

	/** @type {Pair[]} */
	const pairs = [];
	/**
	 * @param {string} id @param {string} what @param {number} threshold
	 * @param {(team: { id: string, colors: any }) => number} ratio
	 * @param {string} [note]
	 */
	const perTeam = (id, what, threshold, ratio, note) =>
		pairs.push({
			id,
			what,
			threshold,
			note,
			results: teams.map((team) => ({ team: team.id, ratio: ratio(team) }))
		});
	/** @param {string} id @param {string} what @param {number} threshold @param {number} ratio */
	const fixed = (id, what, threshold, ratio) =>
		pairs.push({ id, what, threshold, results: [{ team: '', ratio }] });

	/** @param {[string, string]} gradient @param {number} t @returns {Rgb} */
	const stop = (gradient, t) => over(parseHex(gradient[1]), t, parseHex(gradient[0]));

	// ---- the card ----

	const CARD = 'src/lib/components/HockeyCard.svelte';
	const TABLE = 'src/routes/[[lang=locale]]/game/[league]/[team]/CardTable.svelte';
	const angle = Number(src.capture(CARD, /linear-gradient\((\d+)deg, \{lightGradient/));
	const backAngle = Number(src.capture(CARD, /linear-gradient\((\d+)deg, \{darkGradient/));
	const watermark = Number(src.capture(CARD, /\bopacity-\[([\d.]+)\]/));
	const minCard = src.optional(TABLE, /\.card-slot \{[^}]*?min-width:\s*([\d.]+rem)/s);
	const maxCard = src.capture(TABLE, /max-width:\s*(?:max\([^,]+,\s*)?min\(([\d.]+rem)/);
	/** @type {[number, number]} */
	const widths = [minCard ? px(minCard, 0) : NARROWEST_CARD_PX, px(maxCard, 0)];
	const BORDER = 2;

	/** One arbitrary-value utility out of a class list. @param {string} classes @param {string} prefix */
	const arbitrary = (classes, prefix) => {
		const found = classes.split(/\s+/).find((c) => c.startsWith(prefix + '-[') && c.endsWith(']'));
		if (!found) throw new Error('No ' + prefix + '-[…] in "' + classes + '"');
		return found.slice(prefix.length + 2, -1);
	};

	const frontPadding = arbitrary(
		src.capture(
			CARD,
			/<div class="([^"]+)">\s*(?:<!--[\s\S]*?-->\s*)?<span\s+class="[^"]+"[^>]*>\s*\{displayTeamName\}/
		),
		'p'
	);
	const nameClasses = src.capture(CARD, /<span\s+class="([^"]+)"[^>]*>\s*\{displayTeamName\}/);
	const numberClasses = src.capture(
		CARD,
		/<span\s+class="([^"]+)"[^>]*>\s*#\{sweaterNumber\}\s*<\/span>\s*<span[^>]*>\s*\{i18n\.m\.card\.prompt\}/
	);
	const promptClasses = src.capture(
		CARD,
		/<span\s+class="([^"]+)"[^>]*>\s*\{i18n\.m\.card\.prompt\}/
	);
	const name = textBox(nameClasses);
	const number = textBox(numberClasses);
	const prompt = textBox(promptClasses);

	/**
	 * A wrapping caption's possible boxes: one per line count it could come to.
	 * @param {ReturnType<typeof textBox>} box @param {{ em: number, chars: number }} longest
	 * @param {string} padding @param {number} cardPx
	 */
	const caption = (box, longest, padding, cardPx) => {
		const font = px(box.size, cardPx);
		const width = cardPx - 2 * BORDER - 2 * px(padding, cardPx) + 2 * px(box.outdent, cardPx, font);
		const most = linesFor(longest, font, px(box.tracking, cardPx, font), width);
		return Array.from({ length: most }, (_, i) => ({
			lead: px(box.marginTop, cardPx, font),
			height: (i + 1) * font * box.leading + 2 * px(box.padBlock, cardPx, font),
			width
		}));
	};
	/** @param {ReturnType<typeof textBox>} box @param {number} cardPx */
	const numeral = (box, cardPx) => {
		const font = px(box.size, cardPx);
		return [
			{ lead: px(box.marginTop, cardPx, font), height: font * box.leading, width: NUMBER_EM * font }
		];
	};

	const front = layOut({
		angle,
		widths,
		padding: frontPadding,
		gap: '0px',
		rows: (cardPx) => [
			{ key: 'name', variants: caption(name, LONGEST_NAME, frontPadding, cardPx) },
			{ key: 'number', variants: numeral(number, cardPx) },
			{ key: 'prompt', variants: caption(prompt, LONGEST_PROMPT, frontPadding, cardPx) }
		]
	});

	const backColumn = src.capture(CARD, /<div\s+class="([^"]*\bgap-\[[^"]+)"/);
	const backPadding = arbitrary(backColumn, 'p');
	const backGap = arbitrary(backColumn, 'gap');
	const headshot = arbitrary(
		src.capture(CARD, /<img\s+src=\{headshotUrl\}\s+alt=""\s+class="([^"]+)"/),
		'h'
	);
	const playerClasses = src.capture(CARD, /<span\s+class="([^"]+)"\s*>\s*\{playerName\}/);
	const backNumberClasses = src.capture(
		CARD,
		/<span\s+class="([^"]+)"\s+style="color: \{primaryColor\};"\s*>\s*#\{sweaterNumber\}/
	);
	const positionClasses = src.capture(CARD, /<span\s+class="([^"]+)"\s*>\{position\}/);
	const verdictClasses = src.capture(CARD, /\{#if correct === true\}\s*<span\s+class="([^"]+)"/);
	const wrongClasses = src.capture(
		CARD,
		/\{:else if correct === false\}\s*<span\s+class="([^"]+)"/
	);
	const player = textBox(playerClasses);
	const backNumber = textBox(backNumberClasses);
	const position = textBox(positionClasses);
	const verdict = textBox(verdictClasses);

	/** @param {boolean} pictured */
	const backFace = (pictured) =>
		layOut({
			angle: backAngle,
			widths,
			padding: backPadding,
			gap: backGap,
			rows: (cardPx) => {
				const pill = px(verdict.size, cardPx);
				const column = [
					{ key: 'player', variants: caption(player, LONGEST_PLAYER, backPadding, cardPx) },
					{ key: 'backNumber', variants: numeral(backNumber, cardPx) },
					{
						key: 'position',
						variants: caption(position, { em: 0, chars: 0 }, backPadding, cardPx)
					},
					{
						key: 'verdict',
						variants: [
							{
								lead: px(verdict.marginTop, cardPx, pill),
								height: pill * verdict.leading + 2 * px(verdict.padBlock, cardPx, pill),
								width: 0
							}
						]
					}
				];
				const picture = {
					key: 'headshot',
					variants: [{ lead: 0, height: px(headshot, cardPx), width: 0 }]
				};
				return pictured ? [picture, ...column] : column;
			}
		});
	// A player with no picture has no box for one, which puts every line under
	// it higher up the card.
	const back = backFace(true);
	const backBare = backFace(false);
	/** @param {string} key */
	const backStop = (key) => Math.min(back.get(key) ?? 1, backBare.get(key) ?? 1);

	const stops = {
		'front name': front.get('name') ?? 0,
		'front number': front.get('number') ?? 0,
		'front prompt': front.get('prompt') ?? 0,
		'back player': backStop('player'),
		'back number': backStop('backNumber'),
		'back position': backStop('position')
	};

	/** The smallest a line is drawn, across the card's widths. @param {ReturnType<typeof textBox>} box */
	const smallest = (box) => Math.min(px(box.size, widths[0]), px(box.size, widths[1]));
	/** @param {ReturnType<typeof textBox>} box */
	const need = (box) => (isLarge(smallest(box), box.weight) ? LARGE : TEXT);
	/** @param {ReturnType<typeof textBox>} box */
	const sized = (box) =>
		`${smallest(box).toFixed(1)}px${box.weight >= 700 ? ' bold' : ''} at its smallest`;

	/**
	 * A line on the card front: white at some opacity, over an optional dark
	 * scrim, over the gradient with the watermark at its whitest.
	 * @param {'name' | 'number' | 'prompt'} key @param {string} classes
	 */
	const frontRatio = (key, classes) => {
		const utility = colorUtility(classes, 'text');
		const t = front.get(key) ?? 0;
		return (/** @type {{ colors: any }} */ team) => {
			const under = over(WHITE, watermark, stop(team.colors.lightGradient, t));
			// Either the class says how opaque the text is, or the palette does.
			const ink = utility
				? { alpha: color(utility)[1], scrim: 0 }
				: teamColors.frontInk(team.colors)[key];
			const behind = over(BLACK, ink.scrim, under);
			return contrast(over(WHITE, ink.alpha, behind), behind);
		};
	};
	perTeam(
		'front-name',
		`Card front: team name (${sized(name)})`,
		need(name),
		frontRatio('name', nameClasses)
	);
	perTeam(
		'front-number',
		`Card front: number (${sized(number)})`,
		need(number),
		frontRatio('number', numberClasses)
	);
	perTeam(
		'front-prompt',
		`Card front: prompt (${sized(prompt)})`,
		need(prompt),
		frontRatio('prompt', promptClasses)
	);

	/** @param {string} key @param {Rgb | ((team: any) => Rgb)} ink @param {boolean} [watermarked] */
	const backRatio = (key, ink, watermarked = false) => {
		const t = backStop(key);
		return (/** @type {{ colors: any }} */ team) => {
			const under = stop(team.colors.darkGradient, t);
			return contrast(
				typeof ink === 'function' ? ink(team) : ink,
				watermarked ? over(WHITE, watermark, under) : under
			);
		};
	};
	const primary = (/** @type {{ colors: any }} */ team) => parseHex(team.colors.primary);
	const gray = (/** @type {string} */ classes) => {
		const utility = colorUtility(classes, 'text');
		if (!utility) throw new Error(`No text colour in "${classes}"`);
		return color(utility)[0];
	};
	perTeam(
		'back-player',
		`Card back: player name (${sized(player)})`,
		need(player),
		backRatio('player', gray(playerClasses))
	);
	perTeam(
		'back-number',
		`Card back: number in the team colour (${sized(backNumber)})`,
		need(backNumber),
		backRatio('backNumber', primary)
	);
	perTeam(
		'back-position',
		`Card back: position (${sized(position)})`,
		need(position),
		backRatio('position', gray(positionClasses))
	);

	/** @param {string} classes */
	const pill = (classes) => {
		const fg = colorUtility(classes, 'text');
		const bg = colorUtility(classes, 'bg');
		if (!fg || !bg) throw new Error(`No colours in "${classes}"`);
		return contrast(color(fg)[0], color(bg)[0]);
	};
	fixed(
		'verdict-correct',
		`Card back: "Correct" pill (${sized(verdict)})`,
		need(verdict),
		pill(verdictClasses)
	);
	fixed(
		'verdict-wrong',
		`Card back: "Wrong" pill (${sized(verdict)})`,
		need(verdict),
		pill(wrongClasses)
	);

	// ---- around the card ----

	const GAME = 'src/routes/[[lang=locale]]/game/[league]/[team]/RosterGame.svelte';
	const DRAWER = 'src/routes/[[lang=locale]]/game/[league]/[team]/RosterDrawer.svelte';
	const HEADER = 'src/routes/[[lang=locale]]/game/[league]/[team]/GameHeader.svelte';
	const HOME = 'src/routes/[[lang=locale]]/+page.svelte';
	const LAYOUT = 'src/routes/+layout.svelte';

	/** A named colour, opaque. @param {string} classes @param {'text' | 'bg' | 'border'} prefix */
	const solid = (classes, prefix) => {
		const utility = colorUtility(classes, prefix);
		if (!utility) throw new Error(`No ${prefix} colour in "${classes}"`);
		const [rgb, alpha] = color(utility);
		if (alpha !== 1) throw new Error(`Expected an opaque ${prefix} colour in "${classes}"`);
		return rgb;
	};
	/** A translucent utility over a surface. @param {string} classes @param {Rgb} surface */
	const tinted = (classes, surface) => {
		const utility = colorUtility(classes, 'bg');
		if (!utility) throw new Error(`No background in "${classes}"`);
		const [rgb, alpha] = color(utility);
		return over(rgb, alpha, surface);
	};

	const page = solid(src.capture(LAYOUT, /<div class="(flex min-h-dvh flex-col [^"]+)">/), 'bg');
	const table = solid(src.capture(GAME, /class="([^"{]*\bbg-gray-\d+[^"{]*)/), 'bg');
	const drawer = solid(
		src.capture(DRAWER, /bind:this=\{layout\.drawerEl\}\s+class="([^"{]+)/),
		'bg'
	);

	const title = textBox(src.capture(HEADER, /<h1 class="([^"]+)"/));
	perTeam(
		'game-title',
		`Game page: team name heading (${px(title.size, 0)}px${title.weight >= 700 ? ' bold' : ''})`,
		isLarge(px(title.size, 0), title.weight) ? LARGE : TEXT,
		(team) => contrast(parseHex(team.colors.heading), table)
	);

	const option = src.capture(
		DRAWER,
		/style="(border-color: \{primaryColor\}; background: \{primaryColor\}[0-9a-f]{2}; color: \w+;)"/
	);
	const fill =
		parseInt(/background: \{primaryColor\}([0-9a-f]{2})/.exec(option)?.[1] ?? '', 16) / 255;
	const label = /color: (\w+);/.exec(option)?.[1] ?? '';
	// Against the drawer the button sits on, which is what tells a visitor
	// where the control ends. Its fill is a tint of the same colour and is not
	// what the edge has to stand out from.
	perTeam('option-border', 'Roster drawer: answer button border', LARGE, (team) =>
		contrast(parseHex(team.colors.primary), drawer)
	);
	perTeam('option-label', 'Roster drawer: answer button label', TEXT, (team) =>
		contrast(color(label)[0], over(parseHex(team.colors.primary), fill, drawer))
	);

	const tile = src.capture(HOME, /<span\s+class="([^"]+)"\s*>\s*\{name\}\s*<\/span>\s*<\/a>/);
	// The name is the last thing in a tile, but a tile in a short row can be
	// little taller than its name, so the whole gradient is in play.
	perTeam('home-tile', 'Home page: team tile name', TEXT, (team) =>
		contrast(solid(tile, 'text'), stop(team.colors.darkGradient, 0))
	);

	// ---- text no team colours ----

	/**
	 * @param {string} id @param {string} what @param {string} file @param {RegExp} pattern
	 * @param {Rgb} surface @param {number} [threshold]
	 */
	const text = (id, what, file, pattern, surface, threshold = TEXT) =>
		fixed(id, what, threshold, contrast(solid(src.capture(file, pattern), 'text'), surface));

	const ERROR = 'src/routes/+error.svelte';
	const PRIVACY = 'src/routes/[[lang=locale]]/privacy/+page.svelte';
	const TOGGLE = 'src/lib/components/LocaleToggle.svelte';

	text('footer', 'Footer text and links', LAYOUT, /<footer class="([^"]+)"/, page);
	text(
		'league-link',
		'Home page: league not selected',
		HOME,
		/'bg-white\/15 text-white'\s*:\s*'([^']+)'\}"\s*>\s*\{option\.label/,
		tinted(
			src.capture(HOME, /class="(flex flex-wrap justify-center rounded-lg border [^"]+)"/),
			page
		)
	);
	text(
		'locale-link',
		'Nav: language not selected',
		TOGGLE,
		/'bg-white\/15 text-white'\s*:\s*'([^']+)'\}"/,
		tinted(src.capture(TOGGLE, /class="(flex items-center rounded-md border [^"]+)"/), page)
	);
	text(
		'drawer-toggle',
		'Roster drawer: show all / hide roster',
		DRAWER,
		/<span class="(text-xs [^"]+)">/,
		drawer
	);
	text(
		'drawer-heading',
		'Roster drawer: position headings',
		DRAWER,
		/<h2 class="([^"]+)">\s*\{heading\}/,
		drawer
	);
	const idle = src.capture(DRAWER, /\{:else\}\s*<li class="([^"]+)">\s*\{player\.firstName\}/);
	text(
		'drawer-idle',
		'Roster drawer: players who are not an answer',
		DRAWER,
		/\{:else\}\s*<li class="([^"]+)">\s*\{player\.firstName\}/,
		tinted(idle, drawer)
	);
	const done = src.capture(DRAWER, /\{#if identified\}\s*<li\s+class="([^"]+)"/);
	fixed(
		'drawer-identified',
		'Roster drawer: identified players',
		TEXT,
		contrast(solid(done, 'text'), tinted(done, drawer))
	);
	text(
		'progress',
		'Game page: progress line',
		TABLE,
		/<p class="([^"]+)">\s*\{i18n\.m\.game\.identified/,
		table
	);
	text('error-detail', 'Error page: detail line', ERROR, /<p class="([^"]+)">\{detail\}/, page);
	text(
		'error-reference',
		'Error page: reference id',
		ERROR,
		/<p class="([^"]+)">\s*\{i18n\.m\.error\.reference\}/,
		page
	);
	text(
		'privacy-updated',
		'Privacy page: last updated',
		PRIVACY,
		/<p class="([^"]+)">\{i18n\.m\.privacy\.updated/,
		page
	);

	// ---- the watermark on the back ----

	const exposed = pairs
		.filter((p) => p.id === 'back-number' || p.id === 'back-position')
		.map((p) => {
			const key = p.id === 'back-number' ? 'backNumber' : 'position';
			const ink = p.id === 'back-number' ? primary : gray(positionClasses);
			const ratio = backRatio(key, ink, true);
			return `${teams.filter((team) => ratio(team) < p.threshold).length} of ${teams.length} for ${p.id}`;
		});
	const watermarkNote =
		`The logo watermark (${Math.round(watermark * 100)}% opacity) is not in the card-back figures. ` +
		`Were a pure white part of a logo to fall under the text, these would be below threshold: ${exposed.join(', ')}.`;

	// The palette sizes its colours for points of the gradient it states. If
	// the card's layout now reaches an earlier one, a pass above is luck.
	/** @type {Record<string, number> | undefined} */
	const assumed = teamColors.CARD_STOPS;
	const outgrown = Object.entries({
		name: stops['front name'],
		number: stops['front number'],
		prompt: stops['front prompt'],
		backNumber: stops['back number']
	})
		.filter(([key, reached]) => assumed && reached < (assumed[key] ?? 0))
		.map(
			([key, reached]) =>
				`The card's ${key} line reaches ${reached.toFixed(3)} along its gradient, before the ${assumed?.[key]} that src/lib/team-colors.ts allows for in CARD_STOPS.`
		);

	const failures =
		outgrown.length +
		pairs.reduce(
			(sum, pair) => sum + pair.results.filter((r) => r.ratio < pair.threshold).length,
			0
		);
	return { pairs, failures, outgrown, watermarkNote, stops };
}

/** @param {Awaited<ReturnType<typeof audit>>} report @param {boolean} verbose */
export function format(report, verbose = false) {
	const lines = [];
	for (const pair of report.pairs) {
		const failed = pair.results
			.filter((r) => r.ratio < pair.threshold)
			.sort((a, b) => a.ratio - b.ratio);
		const worst = pair.results.reduce((a, b) => (b.ratio < a.ratio ? b : a));
		const count =
			pair.results.length > 1
				? `${failed.length}/${pair.results.length} fail`
				: failed.length
					? 'FAIL'
					: 'ok';
		lines.push(
			`${failed.length ? 'x' : ' '} ${pair.what.padEnd(58)} ${`${pair.threshold}:1`.padEnd(6)} ${count.padEnd(13)} worst ${worst.ratio.toFixed(2)}${worst.team ? ` (${worst.team})` : ''}`
		);
		if (failed.length && pair.results.length > 1) {
			const shown = verbose ? failed : failed.slice(0, 3);
			lines.push(
				`    ${shown.map((r) => `${r.team} ${r.ratio.toFixed(2)}`).join(', ')}${failed.length > shown.length ? ', …' : ''}`
			);
		}
	}
	lines.push('');
	lines.push(
		`Worst point of the gradient each card line reaches (0 = its first colour): ${Object.entries(
			report.stops
		)
			.map(([key, t]) => `${key} ${t.toFixed(2)}`)
			.join(', ')}`
	);
	lines.push(...report.outgrown.map((line) => `x ${line}`));
	lines.push(report.watermarkNote);
	lines.push('');
	lines.push(
		report.failures === 0
			? 'No pair is under its threshold.'
			: `${report.failures} under threshold.`
	);
	return lines.join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const rootAt = args.indexOf('--root');
	const root = rootAt >= 0 ? resolve(args[rootAt + 1] ?? '') : REPO;
	const report = await audit(root);
	console.log(format(report, args.includes('--verbose')));
	process.exitCode = report.failures === 0 ? 0 : 1;
}
