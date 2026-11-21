/**
 * Usage: `node scripts/og-image.mjs` — renders the link-preview image and the
 * PNG icons into static/, and leaves a copy of the preview in the OS temp dir.
 *
 * The images are committed, not built: this only needs running again when the
 * design below changes. It draws with what the site already has — its `#`
 * icon, its fonts (from the @fontsource packages in node_modules) and the
 * card's own proportions — in a page that Playwright's Chromium screenshots.
 *
 * Nothing here may show a league's or a club's name, logo, colours or marks:
 * a card in the game carries them for identification, but this image is the
 * site presenting itself, and NOTICE draws that line. Hence the cards below
 * are in the site's own slate and blue, with no team on them.
 *
 * One image serves both languages. Its words are English; the alt text sent
 * with it (`socialImageAlt` in the catalogues) is translated.
 */
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATIC = join(ROOT, 'static');

const WIDTH = 1200;
const HEIGHT = 630;

// The first sentence of the English meta description (`description` in
// src/lib/i18n/en.ts), which stops short of the part that names the leagues.
const TAGLINE = 'A flashcard game for learning hockey jersey numbers.';
// The card's own prompt (`card.prompt` in the same file).
const PROMPT = 'Who wears this number?';
// Any number would do; nothing is meant by this one.
const NUMBER = '#27';

// The page background (Tailwind's gray-950, as the layout uses) and the icon's
// own slate, from src/lib/assets/favicon.svg.
const BACKGROUND = '#030712';
const ICON_SLATE = '#0f172a';

const icon = readFileSync(join(ROOT, 'src/lib/assets/favicon.svg'), 'utf8');

/** A font from a @fontsource package, as a data: URL the page can load offline. */
function font(pkg, file) {
	const bytes = readFileSync(join(ROOT, 'node_modules/@fontsource', pkg, 'files', file));
	return `url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2')`;
}

const fonts = `
	@font-face { font-family: 'Barlow Condensed'; font-weight: 900;
		src: ${font('barlow-condensed', 'barlow-condensed-latin-900-normal.woff2')}; }
	@font-face { font-family: 'Barlow Condensed'; font-weight: 600;
		src: ${font('barlow-condensed', 'barlow-condensed-latin-600-normal.woff2')}; }
	@font-face { font-family: 'Inter'; font-weight: 500;
		src: ${font('inter', 'inter-latin-500-normal.woff2')}; }
`;

/** The `#` icon without its own background, for use as a card's watermark. */
const watermark = `data:image/svg+xml;base64,${Buffer.from(
	icon.replace(/<rect width="100" height="100"[^>]*\/>/, '')
).toString('base64')}`;

// The cards follow HockeyCard.svelte and CardBack.svelte: 3:4, a 2px border in
// the card's colour, a 160deg gradient, the number in the condensed face.
const previewPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
	${fonts}
	* { box-sizing: border-box; margin: 0; }
	body {
		width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden;
		background: ${BACKGROUND};
		color: white; font-family: 'Inter', sans-serif;
		display: flex; align-items: center;
	}
	.words { flex: 1; padding-left: 80px; }
	.brand { display: flex; align-items: center; gap: 24px; }
	.brand svg { width: 110px; height: 110px; flex: none; }
	.brand span {
		font-family: 'Barlow Condensed', sans-serif; font-weight: 900;
		font-size: 140px; line-height: 1;
	}
	.tagline {
		margin-top: 36px; max-width: 600px;
		font-size: 37px; line-height: 1.35; font-weight: 500; color: #9ca3af;
	}
	.cards { position: relative; flex: none; width: 500px; height: ${HEIGHT}px; }
	.card {
		position: absolute; top: 115px; width: 300px; height: 400px;
		border-radius: 24px; border: 3px solid; overflow: hidden;
	}
	.back {
		left: 20px; rotate: -9deg;
		border-color: #47556988;
		background: linear-gradient(160deg, #1e293b, ${ICON_SLATE});
		box-shadow: 0 20px 40px #0008;
		display: flex; align-items: center; justify-content: center;
	}
	.back img { width: 62%; opacity: 0.08; }
	.front {
		left: 130px; rotate: 6deg;
		border-color: #3b82f666;
		background: linear-gradient(160deg, #2563eb, #0b1535);
		box-shadow: 0 0 36px 6px #3b82f633, 0 20px 40px #0008;
		display: flex; flex-direction: column; align-items: center; justify-content: center;
		font-family: 'Barlow Condensed', sans-serif; text-transform: uppercase;
	}
	.front .watermark { position: absolute; width: 84%; opacity: 0.07; }
	.front .number { position: relative; font-weight: 900; font-size: 142px; line-height: 1; }
	.front .prompt {
		position: relative; margin-top: 18px;
		font-weight: 600; font-size: 20px; letter-spacing: 0.1em; color: #ffffff99;
	}
</style>
</head>
<body>
	<div class="words">
		<div class="brand">${icon}<span>Numbrrs</span></div>
		<p class="tagline">${TAGLINE}</p>
	</div>
	<div class="cards">
		<div class="card back"><img src="${watermark}" alt=""></div>
		<div class="card front">
			<img class="watermark" src="${watermark}" alt="">
			<span class="number">${NUMBER}</span>
			<span class="prompt">${PROMPT}</span>
		</div>
	</div>
</body>
</html>`;

/**
 * The icon alone, filling the page. `square` paints the corners the icon's
 * rounding leaves clear: iOS masks a home-screen icon itself, and shows black
 * wherever the image is transparent.
 */
const iconPage = (square) => `<!doctype html>
<html><head><style>
	* { margin: 0; }
	html, body { width: 100vw; height: 100vh; background: ${square ? ICON_SLATE : 'transparent'}; }
	svg { display: block; width: 100vw; height: 100vh; }
</style></head><body>${icon}</body></html>`;

/**
 * sharp is not a dependency of this project, but pnpm's store has it (other
 * tools bring it in). Used when found, to quantize the PNGs to a palette;
 * without it the screenshots are written as Chromium made them.
 */
function findSharp() {
	const store = join(ROOT, 'node_modules/.pnpm');
	try {
		const entry = readdirSync(store).find((name) => name.startsWith('sharp@'));
		if (!entry) return null;
		return createRequire(import.meta.url)(join(store, entry, 'node_modules/sharp'));
	} catch {
		return null;
	}
}

const sharp = findSharp();

async function write(path, png, { colours }) {
	const out = sharp
		? await sharp(png).png({ palette: true, colours, effort: 10, compressionLevel: 9 }).toBuffer()
		: png;
	writeFileSync(path, out.length < png.length ? out : png);
	console.log(`${path}  ${statSync(path).size} bytes`);
}

const browser = await chromium.launch();
try {
	const context = await browser.newContext({ deviceScaleFactor: 1 });
	const page = await context.newPage();

	async function shoot(html, width, height, omitBackground = false) {
		await page.setViewportSize({ width, height });
		await page.setContent(html);
		await page.evaluate(() => document.fonts.ready);
		return page.screenshot({ type: 'png', omitBackground });
	}

	const preview = join(STATIC, 'og-image.png');
	await write(preview, await shoot(previewPage, WIDTH, HEIGHT), { colours: 256 });
	await write(join(STATIC, 'apple-touch-icon.png'), await shoot(iconPage(true), 180, 180), {
		colours: 32
	});
	await write(join(STATIC, 'favicon-48.png'), await shoot(iconPage(false), 48, 48, true), {
		colours: 32
	});

	// For showing around before it is committed.
	const copy = join(tmpdir(), 'numbrrs-og-image.png');
	copyFileSync(preview, copy);
	console.log(`copy: ${copy}`);
} finally {
	await browser.close();
}
