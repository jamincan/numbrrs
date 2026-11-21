import { defineParams } from '@sveltejs/kit/params';

/**
 * Only non-default locales appear in the URL: French lives under /fr, English
 * stays at the bare path. Matching exactly 'fr' keeps the optional parameter
 * from swallowing the first segment of every other route.
 */
const matchLocale = (param: string) => param === 'fr';

export const params = defineParams({
	locale: (param) => (matchLocale(param) ? param : undefined)
});
