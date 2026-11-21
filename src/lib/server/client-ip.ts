import { isIP } from 'node:net';
import type { RequestEvent } from '@sveltejs/kit';
import { isCloudflareIp } from '#lib/server/cloudflare-ips.ts';
import { SITE_ORIGIN } from '#lib/site.ts';

const CANONICAL_HOST = new URL(SITE_ORIGIN).hostname;

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
 * rate limit in the app (see #lib/server/rate-limit) trivially bypassable, one
 * forged address per attempt.
 *
 * So the header is believed only when the hop that delivered it really was
 * Cloudflare: `Fly-Client-IP` is trustworthy, so requiring *it* to be a
 * Cloudflare edge address is what makes `CF-Connecting-IP` mean something. A
 * direct hit on the Fly hostname falls through and is identified by its own
 * address, which is the correct answer for that path anyway.
 *
 * A Cloudflare address is not enough on its own, though. Cloudflare's edge
 * carries everyone's traffic, not just this zone's: a Worker in any account can
 * fetch `numbrrs.fly.dev`, arrive from a Cloudflare address, and say whatever it
 * likes in `CF-Connecting-IP`. What a Worker cannot do is arrive naming the
 * canonical host: a request for that host is routed through this zone, where
 * Cloudflare writes the header itself. So the header is believed only for the
 * canonical host, and only when it holds an actual address. (Rewriting the Host
 * header on the way to someone else's origin is an Enterprise-plan feature;
 * this narrows the hole to that, it does not close it.)
 *
 * Getting this wrong is worse than it looks in both directions: every visitor
 * collapses into one bucket, which makes a per-visitor count meaningless and a
 * per-IP rate limit into a site-wide outage the first time anyone trips it.
 *
 * The result identifies a visitor rather than an interface, so it is not always
 * a bare address: see `visitorKey`.
 */
export function clientIp(event: RequestEvent): string {
	const flyIp = event.request.headers.get('fly-client-ip')?.trim();

	if (flyIp && isCloudflareIp(flyIp) && event.url.hostname === CANONICAL_HOST) {
		const cfIp = event.request.headers.get('cf-connecting-ip')?.trim();
		if (cfIp && isIP(cfIp)) return visitorKey(cfIp);
	}

	if (flyIp) return visitorKey(flyIp);

	// Only reached off Fly — local dev, tests, or a future host — since Fly always
	// sets its own header. Unverifiable, and treated as such: it ranks below
	// anything the infrastructure vouches for.
	const forwarded = event.request.headers.get('x-forwarded-for');
	// Splitting a non-empty string always yields at least one element; the
	// fallback is unreachable and only satisfies noUncheckedIndexedAccess.
	if (forwarded) return visitorKey((forwarded.split(',')[0] ?? forwarded).trim());

	try {
		return visitorKey(event.getClientAddress());
	} catch {
		return 'unknown';
	}
}

/**
 * The form of an address that everything keyed on it should use.
 *
 * An IPv4 address stands for itself. An IPv6 one is cut to its /64: that is the
 * smallest block a provider hands a single customer, who can then use any of
 * its 2^64 addresses at will. Keyed on the full address, a per-IP rate limit
 * gives such a visitor a fresh bucket per request; keyed on the /64, it sees
 * one visitor.
 *
 * An IPv4 address wrapped as IPv6 (`::ffff:1.2.3.4`, which Node reports on a
 * dual-stack socket) is unwrapped first — otherwise every one of them would
 * share the single /64 they all sit in.
 *
 * Anything that isn't an address comes back untouched. Only the unverifiable
 * fallbacks can produce that, and a stable odd key is better there than none.
 */
export function visitorKey(address: string): string {
	if (isIP(address) !== 6) return address;

	const groups = ipv6Groups(address);
	if (!groups) return address;

	const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
	if (g0 + g1 + g2 + g3 + g4 === 0 && g5 === 0xffff) {
		return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
	}

	return `${[g0, g1, g2, g3].map((group) => group.toString(16)).join(':')}::/64`;
}

type Ipv6Groups = [number, number, number, number, number, number, number, number];

/**
 * The eight 16-bit groups of an address `isIP` has already called IPv6, so this
 * only has to undo the notation's shorthands, not validate it.
 */
function ipv6Groups(address: string): Ipv6Groups | null {
	// A zone ('fe80::1%eth0') names a local interface, not part of the address.
	let text = address.split('%')[0] ?? address;

	// A dotted quad may stand in for the last two groups.
	const lastColon = text.lastIndexOf(':');
	const tail = text.slice(lastColon + 1);
	if (tail.includes('.')) {
		const [a = 0, b = 0, c = 0, d = 0] = tail.split('.').map(Number);
		text = `${text.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
	}

	// '::' stands for however many zero groups bring the total to eight.
	const [head = '', rest] = text.split('::');
	const before = head === '' ? [] : head.split(':');
	const after = rest === undefined || rest === '' ? [] : rest.split(':');
	const missing = rest === undefined ? 0 : 8 - before.length - after.length;

	const groups = [...before, ...Array<string>(Math.max(missing, 0)).fill('0'), ...after].map(
		(group) => parseInt(group, 16)
	);
	if (groups.length !== 8 || groups.some((group) => !Number.isInteger(group))) return null;
	return groups as Ipv6Groups;
}
