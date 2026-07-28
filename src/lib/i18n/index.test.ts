import { describe, expect, it } from 'vitest';
import {
	isLocale,
	localeFromPath,
	localizePath,
	negotiateLocale,
	parseAcceptLanguage
} from './index';

describe('isLocale', () => {
	it('accepts supported locales', () => {
		expect(isLocale('en')).toBe(true);
		expect(isLocale('fr')).toBe(true);
	});

	it('rejects everything else', () => {
		expect(isLocale('de')).toBe(false);
		expect(isLocale('EN')).toBe(false);
		expect(isLocale('')).toBe(false);
		expect(isLocale(null)).toBe(false);
		expect(isLocale(undefined)).toBe(false);
	});
});

describe('parseAcceptLanguage', () => {
	it('returns undefined for missing or empty headers', () => {
		expect(parseAcceptLanguage(null)).toBeUndefined();
		expect(parseAcceptLanguage(undefined)).toBeUndefined();
		expect(parseAcceptLanguage('')).toBeUndefined();
	});

	it('matches a bare language tag', () => {
		expect(parseAcceptLanguage('fr')).toBe('fr');
		expect(parseAcceptLanguage('en')).toBe('en');
	});

	it('matches on the primary subtag', () => {
		expect(parseAcceptLanguage('fr-CA')).toBe('fr');
		expect(parseAcceptLanguage('en-GB')).toBe('en');
	});

	it('respects quality ordering', () => {
		expect(parseAcceptLanguage('en;q=0.5,fr')).toBe('fr');
		expect(parseAcceptLanguage('fr-CA,fr;q=0.9,en;q=0.8')).toBe('fr');
		expect(parseAcceptLanguage('en-US,en;q=0.9,fr;q=0.8')).toBe('en');
	});

	it('skips unsupported languages to find a supported one', () => {
		expect(parseAcceptLanguage('de-DE,de;q=0.9,fr;q=0.8')).toBe('fr');
	});

	it('returns undefined when nothing is supported', () => {
		expect(parseAcceptLanguage('de,es;q=0.9')).toBeUndefined();
	});

	it('survives malformed input', () => {
		expect(parseAcceptLanguage(',,;q=,')).toBeUndefined();
		expect(parseAcceptLanguage('fr;q=not-a-number')).toBeUndefined();
		expect(parseAcceptLanguage('*')).toBeUndefined();
	});
});

describe('localeFromPath', () => {
	it('reads French off the prefix', () => {
		expect(localeFromPath('/fr')).toBe('fr');
		expect(localeFromPath('/fr/')).toBe('fr');
		expect(localeFromPath('/fr/game/nhl/TOR')).toBe('fr');
		expect(localeFromPath('/fr/nonexistent')).toBe('fr');
	});

	it('defaults to English everywhere else', () => {
		expect(localeFromPath('/')).toBe('en');
		expect(localeFromPath('/game/nhl/TOR')).toBe('en');
		expect(localeFromPath('/nonexistent')).toBe('en');
	});

	it('does not mistake look-alike segments for the prefix', () => {
		expect(localeFromPath('/frost')).toBe('en');
		expect(localeFromPath('/french')).toBe('en');
	});

	it('round-trips with localizePath', () => {
		for (const path of ['/', '/game/nhl/TOR', '/frost']) {
			expect(localeFromPath(localizePath(path, 'fr'))).toBe('fr');
			expect(localeFromPath(localizePath(path, 'en'))).toBe('en');
		}
	});
});

describe('localizePath', () => {
	it('prefixes French paths', () => {
		expect(localizePath('/', 'fr')).toBe('/fr');
		expect(localizePath('/game/nhl/TOR', 'fr')).toBe('/fr/game/nhl/TOR');
	});

	it('strips the prefix for English', () => {
		expect(localizePath('/fr', 'en')).toBe('/');
		expect(localizePath('/fr/game/nhl/TOR', 'en')).toBe('/game/nhl/TOR');
	});

	it('leaves already-localized paths alone', () => {
		expect(localizePath('/game/nhl/TOR', 'en')).toBe('/game/nhl/TOR');
		expect(localizePath('/fr/game/nhl/TOR', 'fr')).toBe('/fr/game/nhl/TOR');
	});

	it('does not mistake look-alike segments for the prefix', () => {
		expect(localizePath('/frost', 'en')).toBe('/frost');
		expect(localizePath('/frost', 'fr')).toBe('/fr/frost');
	});
});

describe('negotiateLocale', () => {
	it('lets an explicit cookie win', () => {
		expect(negotiateLocale('fr', 'en-US,en;q=0.9')).toBe('fr');
	});

	it('falls back to the header when the cookie is invalid', () => {
		expect(negotiateLocale('klingon', 'fr-CA')).toBe('fr');
		expect(negotiateLocale(undefined, 'fr')).toBe('fr');
	});

	it('defaults to English when neither helps', () => {
		expect(negotiateLocale(undefined, undefined)).toBe('en');
		expect(negotiateLocale('xx', 'de')).toBe('en');
	});
});
