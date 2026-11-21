/**
 * What the Cloudflare Worker and the origin have to agree on for the Worker to
 * report the page views it answers from its cache, which the origin never
 * sees. One side builds these and the other checks them, so the shape and the
 * limits live here, imported by both: cloudflare/locale-cache-worker.ts and
 * src/routes/api/hit/+server.ts.
 *
 * Kept free of imports so the Worker's bundle takes in nothing but this file.
 */

/** Where the Worker sends its reports. */
export const HIT_PATH = '/api/hit';

/**
 * One page view served from the edge: the page, and the three things the
 * origin reads off a request of its own to count a visitor. None of it is
 * stored as sent — see `recordEdgeViews` in #lib/server/analytics.ts.
 */
export interface EdgeHit {
	/** The path the visitor asked for, as it was in the URL. */
	path: string;
	/** Their address, from Cloudflare's `CF-Connecting-IP`. */
	ip: string;
	/** Their `User-Agent`. */
	ua: string;
	/** Their `Referer`, if they sent one. */
	ref: string | null;
}

/** The most reports one request carries. The Worker never gathers more before sending. */
export const MAX_HITS = 25;

/**
 * Caps on each field, applied by the Worker before it sends and checked by the
 * origin on arrival. Together with `MAX_HITS` they are what bound a request
 * body.
 *
 * A view of a longer path is not reported at all: half a path names a
 * different page or none, and no page that can be cached has one this long.
 *
 * A longer user agent or referrer is cut instead. A referrer survives that,
 * since only its hostname is kept. A user agent cut short hashes to a
 * different visitor than the same browser does on a request the origin serves
 * itself — a real browser's is a few hundred characters, so the one this
 * happens to was sending something unusual anyway.
 */
export const MAX_HIT_PATH = 600;
export const MAX_HIT_IP = 45;
export const MAX_HIT_UA = 512;
export const MAX_HIT_REF = 512;
