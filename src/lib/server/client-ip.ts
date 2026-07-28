import type { RequestEvent } from '@sveltejs/kit';

/**
 * Fly terminates TLS at its proxy, so the socket address the server sees is the
 * proxy's — the same value for every visitor. `Fly-Client-IP` is the real one.
 * Fly's proxy sets it on every request and overwrites whatever the client sent,
 * so it can't be spoofed from outside — as long as Fly's edge is the first hop.
 *
 * Once Cloudflare sits in front of Fly, that stops being true: the connection
 * Fly sees comes from Cloudflare, so `Fly-Client-IP` becomes Cloudflare's edge
 * IP for every visitor rather than the visitor's own — the same collapse this
 * function exists to avoid, just moved one hop out. Cloudflare's own
 * `CF-Connecting-IP` carries the real one, so it's checked first.
 *
 * `CF-Connecting-IP` is only trustworthy because Cloudflare is meant to be the
 * only way in. Fly's own default hostname (`numbrrs.fly.dev`) stays directly
 * reachable regardless of what DNS for the custom domain points at, and Fly
 * doesn't know to strip a client-supplied `CF-Connecting-IP` on that path — so
 * this remains spoofable by anyone who bypasses Cloudflare and hits the Fly
 * hostname directly, the same way `X-Forwarded-For` below always has been.
 *
 * Getting this wrong is worse than it looks in both directions: every visitor
 * collapses into one bucket, which makes a per-visitor count meaningless and a
 * per-IP rate limit into a site-wide outage the first time anyone trips it.
 */
export function clientIp(event: RequestEvent): string {
	const cfIp = event.request.headers.get('cf-connecting-ip');
	if (cfIp) return cfIp;

	const flyIp = event.request.headers.get('fly-client-ip');
	if (flyIp) return flyIp;

	const forwarded = event.request.headers.get('x-forwarded-for');
	// Splitting a non-empty string always yields at least one element; the
	// fallback is unreachable and only satisfies noUncheckedIndexedAccess.
	if (forwarded) return (forwarded.split(',')[0] ?? forwarded).trim();

	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}
