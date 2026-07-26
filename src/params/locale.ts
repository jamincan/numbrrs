import type { ParamMatcher } from '@sveltejs/kit';

/**
 * Only non-default locales appear in the URL: French lives under /fr, English
 * stays at the bare path. Matching exactly 'fr' keeps the optional parameter
 * from swallowing the first segment of every other route.
 */
export const match: ParamMatcher = (param) => param === 'fr';
