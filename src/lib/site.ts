/**
 * Canonical origin for absolute URLs (hreflang, canonical, Open Graph, the
 * sitemap). The app also answers on numbrrs.fly.dev; pointing canonicals here
 * keeps search engines from treating the two hosts as duplicate sites.
 *
 * Moved from numbrrs.ca on 2026-07-28 — easily mistyped as numbers.ca, an
 * unrelated bar's domain. hooks.server.ts 301s the old domain here.
 */
export const SITE_ORIGIN = 'https://numbrrs.app';

/**
 * Hostnames that redirect straight to SITE_ORIGIN rather than serving their
 * own copy — see hooks.server.ts. A visitor bouncing through one of these
 * still counts as internal navigation, not a real referral: see
 * OWN_HOSTNAMES below, which is what actually gets used for that.
 */
export const REDIRECT_HOSTNAMES = new Set(['numbrrs.ca', 'www.numbrrs.app']);

/**
 * Every hostname this app answers on or redirects from. `analytics.ts` drops
 * these from referrer tracking — otherwise a visitor redirected from
 * www.numbrrs.app (or the retired numbrrs.ca) to the canonical host shows up
 * as their own referrer, since the browser's Referer on the request that
 * follows a redirect is the pre-redirect URL.
 */
export const OWN_HOSTNAMES = new Set([
	new URL(SITE_ORIGIN).hostname,
	'numbrrs.fly.dev',
	...REDIRECT_HOSTNAMES
]);
