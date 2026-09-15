/**
 * Is this address one of Cloudflare's edge servers?
 *
 * `CF-Connecting-IP` is a claim, not a fact: it is only worth anything when
 * Cloudflare is the one making it. This module is what lets `clientIp` tell the
 * difference — see $lib/server/client-ip for why that matters here.
 *
 * The ranges are vendored rather than fetched. Fetching them would put a
 * network call on the path of every request that needs an IP, and a cached copy
 * that fails to refresh fails *open* — every visitor's spoofed header suddenly
 * believed. Cloudflare changes this list rarely and announces it; refresh from
 * https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6 when
 * they do. A stale list fails safe: an unrecognized edge IP means we fall back
 * to Fly's own header, which costs accuracy, not security.
 *
 * Last refreshed: 2026-07-30.
 */
const CLOUDFLARE_RANGES = [
	// IPv4
	'173.245.48.0/20',
	'103.21.244.0/22',
	'103.22.200.0/22',
	'103.31.4.0/22',
	'141.101.64.0/18',
	'108.162.192.0/18',
	'190.93.240.0/20',
	'188.114.96.0/20',
	'197.234.240.0/22',
	'198.41.128.0/17',
	'162.158.0.0/15',
	'104.16.0.0/13',
	'104.24.0.0/14',
	'172.64.0.0/13',
	'131.0.72.0/22',
	// IPv6
	'2400:cb00::/32',
	'2606:4700::/32',
	'2803:f800::/32',
	'2405:b500::/32',
	'2405:8100::/32',
	'2a06:98c0::/29',
	'2c0f:f248::/32'
];

/**
 * An address as a plain integer plus its width, so v4 and v6 share one
 * comparison. BigInt throughout: v6 needs 128 bits, and one code path that is
 * obviously correct beats two that are each fast.
 */
interface ParsedIp {
	bits: 32 | 128;
	value: bigint;
}

/**
 * Deliberately stricter than `Number()`: it would accept '1e2', ' 12' and
 * '0x10' as octets, and leading zeros have historically been read as octal by
 * some parsers and as decimal by others — which is exactly the ambiguity an
 * address used for an access decision must not have.
 */
const OCTET = /^(0|[1-9]\d{0,2})$/;

function parseIpv4(value: string): bigint | null {
	const parts = value.split('.');
	if (parts.length !== 4) return null;

	let out = 0n;
	for (const part of parts) {
		if (!OCTET.test(part)) return null;
		const octet = Number(part);
		if (octet > 255) return null;
		out = (out << 8n) | BigInt(octet);
	}
	return out;
}

const HEXTET = /^[0-9a-f]{1,4}$/i;

/**
 * The groups on one side of a '::', where the final group may be a dotted quad
 * (as in `::ffff:1.2.3.4`) and counts as two.
 */
function parseGroups(parts: string[]): bigint[] | null {
	const out: bigint[] = [];

	for (const [index, part] of parts.entries()) {
		if (part.includes('.')) {
			// An embedded IPv4 address is only legal as the very last thing.
			if (index !== parts.length - 1) return null;
			const v4 = parseIpv4(part);
			if (v4 === null) return null;
			out.push(v4 >> 16n, v4 & 0xffffn);
			continue;
		}

		if (!HEXTET.test(part)) return null;
		out.push(BigInt(parseInt(part, 16)));
	}

	return out;
}

function parseIpv6(value: string): bigint | null {
	// A link-local address can carry a zone ('fe80::1%eth0'), which says nothing
	// about which network it is in.
	const zone = value.indexOf('%');
	const address = zone === -1 ? value : value.slice(0, zone);

	const gap = address.indexOf('::');
	// '::' means "all the zeros needed to reach eight groups", so a second one
	// would be ambiguous.
	if (gap !== -1 && address.indexOf('::', gap + 1) !== -1) return null;

	const before = gap === -1 ? address : address.slice(0, gap);
	const after = gap === -1 ? '' : address.slice(gap + 2);

	const head = parseGroups(before === '' ? [] : before.split(':'));
	const tail = parseGroups(after === '' ? [] : after.split(':'));
	if (head === null || tail === null) return null;

	const total = head.length + tail.length;
	if (gap === -1) {
		if (total !== 8) return null;
	} else if (total > 7) {
		return null;
	}

	const groups = [...head, ...Array<bigint>(8 - total).fill(0n), ...tail];
	let out = 0n;
	for (const group of groups) out = (out << 16n) | group;
	return out;
}

function parseIp(value: string): ParsedIp | null {
	if (!value.includes(':')) {
		const v4 = parseIpv4(value);
		return v4 === null ? null : { bits: 32, value: v4 };
	}

	const v6 = parseIpv6(value);
	if (v6 === null) return null;

	// ::ffff:0:0/96 is an IPv4 address wearing a v6 costume — Node hands these
	// back on dual-stack sockets. Unwrap it, or it would never match a v4 range.
	if (v6 >> 32n === 0xffffn) return { bits: 32, value: v6 & 0xffffffffn };

	return { bits: 128, value: v6 };
}

const PREFIX = /^\d{1,3}$/;

/**
 * Does `ip` fall inside `cidr`? Returns false rather than throwing for anything
 * malformed on either side: a header we can't parse is a header we don't trust,
 * which is the same answer.
 */
export function ipInCidr(ip: string, cidr: string): boolean {
	const slash = cidr.indexOf('/');
	if (slash === -1) return false;

	const prefixText = cidr.slice(slash + 1);
	if (!PREFIX.test(prefixText)) return false;
	const prefix = Number(prefixText);

	const network = parseIp(cidr.slice(0, slash));
	const address = parseIp(ip);
	if (network === null || address === null) return false;
	// A v4 address is not in a v6 range and vice versa.
	if (network.bits !== address.bits) return false;
	if (prefix > network.bits) return false;

	const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(network.bits - prefix);
	return (address.value & mask) === (network.value & mask);
}

export function isCloudflareIp(ip: string): boolean {
	return CLOUDFLARE_RANGES.some((cidr) => ipInCidr(ip, cidr));
}
