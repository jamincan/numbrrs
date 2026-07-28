import { describe, expect, it } from 'vitest';
import { bucketLocale, cookieValue } from './locale-cache-worker';

function requestWith(headers: Record<string, string>): Request {
	return new Request('https://numbrrs.app/privacy', { headers });
}

describe('cookieValue', () => {
	it('finds the named cookie among others', () => {
		expect(cookieValue('a=1; numbrrs_locale=fr; b=2', 'numbrrs_locale')).toBe('fr');
	});

	it('is undefined when the cookie is absent', () => {
		expect(cookieValue('a=1; b=2', 'numbrrs_locale')).toBeUndefined();
		expect(cookieValue('', 'numbrrs_locale')).toBeUndefined();
	});
});

describe('bucketLocale', () => {
	it('is always fr under the /fr prefix, regardless of cookie or Accept-Language', () => {
		const request = requestWith({ cookie: 'numbrrs_locale=en', 'accept-language': 'en' });
		expect(bucketLocale('/fr/privacy', request)).toBe('fr');
		expect(bucketLocale('/fr', request)).toBe('fr');
	});

	it('follows an explicit cookie over Accept-Language on an unprefixed path', () => {
		const request = requestWith({
			cookie: 'numbrrs_locale=fr',
			'accept-language': 'en-US,en;q=0.9'
		});
		expect(bucketLocale('/privacy', request)).toBe('fr');
	});

	it('falls back to Accept-Language when there is no cookie', () => {
		const request = requestWith({ 'accept-language': 'fr-CA,fr;q=0.9,en;q=0.8' });
		expect(bucketLocale('/privacy', request)).toBe('fr');
	});

	it('defaults to en with no cookie and no matching Accept-Language', () => {
		const request = requestWith({});
		expect(bucketLocale('/privacy', request)).toBe('en');
	});

	it('respects q=0 as an explicit refusal, matching negotiateLocale', () => {
		const request = requestWith({ 'accept-language': 'fr;q=0' });
		expect(bucketLocale('/privacy', request)).toBe('en');
	});
});
