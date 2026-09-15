import type { RequestEvent } from '@sveltejs/kit';
import { isCloudflareIp } from '$lib/server/cloudflare-ips';

/**
 * Fly terminates TLS at its proxy, so the socket address the server sees is the
 * proxy's — the same value for every visitor. `Fly-Client-IP` is the real one.
 * Fly's proxy sets it on every request and overwrites whatever the client sent,
 * so it can't be spoofed from outside.
 *
 * Once Cloudflare sits in front of Fly, that stops being true: the connection
 * Fly sees comes from Cloudflare, so `Fly-Client-IP` becomes Cloudflare's edge
 * IP for every visitor rather than the visitor's own — the same collapse this
 * function exists to avoid, just moved one hop out. Cloudflare's own
 * `CF-Connecting-IP` carries the real one.
 *
 * But `CF-Connecting-IP` is just a header, and Fly's own hostname
 * (`numbrrs.fly.dev`) stays directly reachable regardless of what DNS for the
 * custom domain points at. Anyone hitting it can send any `CF-Connecting-IP`
 * they like, and Fly has no reason to strip it — which would make every per-IP
 * rate limit in the app (see $lib/server/rate-limit) trivially bypassable, one
 * forged address per attempt.
 *
 * So the header is believed only when the hop that delivered it really was
 * Cloudflare: `Fly-Client-IP` is trustworthy, so requiring *it* to be a
 * Cloudflare edge address is what makes `CF-Connecting-IP` mean something. A
 * direct hit on the Fly hostname falls through and is identified by its own
 * address, which is the correct answer for that path anyway.
 *
 * Getting this wrong is worse than it looks in both directions: every visitor
 * collapses into one bucket, which makes a per-visitor count meaningless and a
 * per-IP rate limit into a site-wide outage the first time anyone trips it.
 */
export function clientIp(event: RequestEvent): string {
	const flyIp = event.request.headers.get('fly-client-ip');

	if (flyIp && isCloudflareIp(flyIp)) {
		const cfIp = event.request.headers.get('cf-connecting-ip');
		if (cfIp) return cfIp;
	}

	if (flyIp) return flyIp;

	// Only reached off Fly — local dev, tests, or a future host — since Fly always
	// sets its own header. Unverifiable, and treated as such: it ranks below
	// anything the infrastructure vouches for.
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
