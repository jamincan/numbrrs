import { isIP } from 'node:net';
import { z } from 'zod';
import { EDGE_TOKEN } from '$app/env/private';
import { match } from '$app/paths';
import { MAX_HITS, MAX_HIT_IP, MAX_HIT_PATH, MAX_HIT_REF, MAX_HIT_UA } from '#lib/edge-hits.ts';
import { isLocale, localeFromPath } from '#lib/i18n/index.ts';
import { tokenMatches } from '#lib/server/admin.ts';
import { recordEdgeViews, type EventPage, type EventVisitor } from '#lib/server/analytics.ts';
import { visitorKey } from '#lib/server/client-ip.ts';
import { isLocalizedRoute } from '#lib/server/request-policy.ts';
import type { RequestHandler } from './$types';

/**
 * Where the Cloudflare Worker reports the page views it answered from its
 * cache (see cloudflare/locale-cache-worker.ts). A view is otherwise counted as
 * the origin renders the page, so one the edge serves would go uncounted, and
 * the better the cache does its job the less the dashboard would show.
 *
 * A report says whose view it was — an address, a user agent, a referrer — and
 * this is the only place those are taken from a request body instead of from
 * the request. That is safe for exactly one caller, so it is the one thing
 * here that needs a secret: anyone else able to post would be able to invent
 * visitors. Nothing about the request that carries the report is recorded; it
 * comes from Cloudflare's network, not from a visitor.
 *
 * The address is used as it is for a request the origin serves itself: it goes
 * into the day's visitor hash and is not stored, logged or kept.
 *
 * This runs on a machine with one shared CPU and room for 25 connections, in
 * the middle of whatever traffic made the cache worth having, so it does as
 * little as it can: no page is rendered, the body is small and bounded, a
 * whole batch is one transaction, and the answer has no body.
 */

/**
 * Room for a full batch with every field at its cap and every character of it
 * escaped, and nothing like room for more.
 */
const MAX_BODY = 96 * 1024;

/**
 * Checked one report at a time, so a bad one costs only itself: the Worker
 * does not wait for the answer and would not send the rest again.
 *
 * Only the referrer may be missing or malformed without the report being
 * dropped, as a browser is free not to send one. An address that is not an
 * address is refused rather than counted under a made-up visitor.
 */
const hitSchema = z.object({
	path: z.string().startsWith('/').max(MAX_HIT_PATH),
	ip: z
		.string()
		.max(MAX_HIT_IP)
		.refine((ip) => isIP(ip) !== 0),
	ua: z.string().max(MAX_HIT_UA),
	ref: z.string().max(MAX_HIT_REF).nullable().catch(null)
});

const batchSchema = z.array(z.unknown()).max(MAX_HITS);

/**
 * What SvelteKit appends to a page's path to ask for its data alone, which is
 * how a client-side navigation arrives. The framework strips it before routing
 * and the view is recorded against the page; a reported one gets the same.
 */
const DATA_SUFFIX = '/__data.json';

function pagePath(path: string): string {
	return path.endsWith(DATA_SUFFIX) ? path.slice(0, -DATA_SUFFIX.length) || '/' : path;
}

/** No body and never stored: there is nothing to say and nobody to cache it for. */
function answer(status: number): Response {
	return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function bearerToken(request: Request): string | null {
	const header = request.headers.get('authorization') ?? '';
	const [scheme, token] = header.split(' ');
	return scheme?.toLowerCase() === 'bearer' && token ? token : null;
}

/**
 * The page a reported path is, according to the router that would have served
 * it — so the route id and parameters on the row are the ones a rendered view
 * of the same URL carries, with nothing taken on the reporter's word. Null for
 * a path the origin would not have counted: no such route, or not a page.
 */
async function pageFor(path: string, base: URL): Promise<EventPage | null> {
	const url = new URL(base);
	// Set on a URL that already has its host, not resolved against one: a path
	// starting `//` would otherwise be read as naming a different host.
	url.pathname = pagePath(path);
	url.search = '';

	const route = await match(url);
	if (!route || !isLocalizedRoute(route.id)) return null;

	const params: Partial<Record<string, string>> = route.params;
	return {
		pathname: url.pathname,
		routeId: route.id,
		params,
		locale: isLocale(params.lang) ? params.lang : localeFromPath(url.pathname)
	};
}

export const POST: RequestHandler = async ({ request, url }) => {
	// Refused the same way whether no secret is configured here or the one sent
	// is wrong, and before the body is looked at: an unauthenticated caller gets
	// to make this server do nothing at all.
	const token = bearerToken(request);
	if (!EDGE_TOKEN || !token || !tokenMatches(token, EDGE_TOKEN)) return answer(401);

	if (Number(request.headers.get('content-length')) > MAX_BODY) return answer(413);
	const raw = await request.text();
	if (raw.length > MAX_BODY) return answer(413);

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return answer(400);
	}

	const batch = batchSchema.safeParse(parsed);
	if (!batch.success) return answer(400);

	const views: { page: EventPage; visitor: EventVisitor }[] = [];
	for (const item of batch.data) {
		const hit = hitSchema.safeParse(item);
		if (!hit.success) continue;

		const page = await pageFor(hit.data.path, url);
		if (!page) continue;

		views.push({
			page,
			visitor: {
				ip: visitorKey(hit.data.ip),
				userAgent: hit.data.ua,
				referer: hit.data.ref,
				hostname: url.hostname
			}
		});
	}

	recordEdgeViews(views);

	return answer(204);
};
