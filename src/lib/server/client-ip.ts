import type { RequestEvent } from '@sveltejs/kit';

/**
 * Fly terminates TLS at its proxy, so the socket address the server sees is the
 * proxy's — the same value for every visitor. `Fly-Client-IP` is the real one.
 * Fly's proxy sets it on every request and overwrites whatever the client sent,
 * so it can't be spoofed from outside.
 *
 * Getting this wrong is worse than it looks in both directions: every visitor
 * collapses into one bucket, which makes a per-visitor count meaningless and a
 * per-IP rate limit into a site-wide outage the first time anyone trips it.
 */
export function clientIp(event: RequestEvent): string {
	const flyIp = event.request.headers.get('fly-client-ip');
	if (flyIp) return flyIp;

	const forwarded = event.request.headers.get('x-forwarded-for');
	if (forwarded) return forwarded.split(',')[0].trim();

	try {
		return event.getClientAddress();
	} catch {
		return 'unknown';
	}
}
