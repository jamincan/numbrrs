import { describe, expect, it } from 'vitest';
import { ipInCidr, isCloudflareIp } from './cloudflare-ips';

describe('ipInCidr', () => {
	describe('IPv4', () => {
		it('matches inside the range and not outside it', () => {
			expect(ipInCidr('104.16.0.1', '104.16.0.0/13')).toBe(true);
			expect(ipInCidr('104.23.255.255', '104.16.0.0/13')).toBe(true);
			// One past the top of a /13.
			expect(ipInCidr('104.24.0.0', '104.16.0.0/13')).toBe(false);
			// One below the bottom.
			expect(ipInCidr('104.15.255.255', '104.16.0.0/13')).toBe(false);
		});

		it('handles the boundary prefixes', () => {
			expect(ipInCidr('1.2.3.4', '1.2.3.4/32')).toBe(true);
			expect(ipInCidr('1.2.3.5', '1.2.3.4/32')).toBe(false);
			// /0 is every address, which is worth pinning down given it is also what
			// a mask built by shifting would produce if the shift went wrong.
			expect(ipInCidr('203.0.113.9', '0.0.0.0/0')).toBe(true);
		});
	});

	describe('IPv6', () => {
		it('matches inside the range and not outside it', () => {
			expect(ipInCidr('2606:4700::1', '2606:4700::/32')).toBe(true);
			expect(ipInCidr('2606:4700:ffff:ffff:ffff:ffff:ffff:ffff', '2606:4700::/32')).toBe(true);
			expect(ipInCidr('2606:4701::1', '2606:4700::/32')).toBe(false);
		});

		it('handles a prefix that does not land on a group boundary', () => {
			// /29 leaves the low three bits of the second group free, so the range
			// runs 2a06:98c0 through 2a06:98c7 — it ends mid-group, which is the
			// case a mask built per group would get wrong.
			expect(ipInCidr('2a06:98c0::1', '2a06:98c0::/29')).toBe(true);
			expect(ipInCidr('2a06:98c7:ffff::1', '2a06:98c0::/29')).toBe(true);
			expect(ipInCidr('2a06:98c8::1', '2a06:98c0::/29')).toBe(false);
		});

		it('expands :: consistently on both sides', () => {
			expect(ipInCidr('::1', '::/0')).toBe(true);
			expect(ipInCidr('2606:4700:0:0:0:0:0:1', '2606:4700::/32')).toBe(true);
			expect(ipInCidr('::', '::/128')).toBe(true);
		});

		it('ignores a zone id', () => {
			expect(ipInCidr('2606:4700::1%eth0', '2606:4700::/32')).toBe(true);
		});

		it('unwraps IPv4-mapped addresses so they match v4 ranges', () => {
			// What a dual-stack socket reports for a plain IPv4 client.
			expect(ipInCidr('::ffff:104.16.0.1', '104.16.0.0/13')).toBe(true);
			expect(ipInCidr('::ffff:8.8.8.8', '104.16.0.0/13')).toBe(false);
		});
	});

	it('never matches a v4 address against a v6 range, or the reverse', () => {
		expect(ipInCidr('1.2.3.4', '::/0')).toBe(false);
		expect(ipInCidr('2606:4700::1', '0.0.0.0/0')).toBe(false);
	});

	it('refuses anything malformed rather than throwing', () => {
		const cidr = '104.16.0.0/13';

		expect(ipInCidr('', cidr)).toBe(false);
		expect(ipInCidr('not-an-ip', cidr)).toBe(false);
		expect(ipInCidr('104.16.0', cidr)).toBe(false);
		expect(ipInCidr('104.16.0.0.1', cidr)).toBe(false);
		expect(ipInCidr('104.16.0.256', cidr)).toBe(false);
		expect(ipInCidr('104.16.0.-1', cidr)).toBe(false);
		// Leading zeros are read as octal by some parsers and decimal by others.
		expect(ipInCidr('104.016.0.1', cidr)).toBe(false);
		// Number() would take both of these.
		expect(ipInCidr('104.16.0.1e0', cidr)).toBe(false);
		expect(ipInCidr(' 104.16.0.1', cidr)).toBe(false);
		// Two '::' leave the group count ambiguous.
		expect(ipInCidr('2606::4700::1', '2606:4700::/32')).toBe(false);
		expect(ipInCidr('2606:4700:12345::1', '2606:4700::/32')).toBe(false);
		// An embedded v4 address is only legal as the last piece.
		expect(ipInCidr('::1.2.3.4:5', '::/0')).toBe(false);

		expect(ipInCidr('104.16.0.1', '104.16.0.0')).toBe(false);
		expect(ipInCidr('104.16.0.1', '104.16.0.0/')).toBe(false);
		expect(ipInCidr('104.16.0.1', '104.16.0.0/33')).toBe(false);
		expect(ipInCidr('104.16.0.1', '104.16.0.0/abc')).toBe(false);
		expect(ipInCidr('2606:4700::1', '2606:4700::/129')).toBe(false);
	});
});

describe('isCloudflareIp', () => {
	it('recognizes published edge ranges', () => {
		expect(isCloudflareIp('104.16.0.1')).toBe(true);
		expect(isCloudflareIp('172.64.0.1')).toBe(true);
		expect(isCloudflareIp('131.0.72.1')).toBe(true);
		expect(isCloudflareIp('2606:4700::1')).toBe(true);
		expect(isCloudflareIp('2c0f:f248::1')).toBe(true);
	});

	it('rejects everything else, including addresses next to a range', () => {
		expect(isCloudflareIp('8.8.8.8')).toBe(false);
		expect(isCloudflareIp('192.168.1.1')).toBe(false);
		// 104.16.0.0/13 ends at 104.23.255.255 and 104.24.0.0/14 picks up there,
		// so the first address outside both is 104.28.0.0.
		expect(isCloudflareIp('104.28.0.0')).toBe(false);
		expect(isCloudflareIp('2001:4860:4860::8888')).toBe(false);
		expect(isCloudflareIp('')).toBe(false);
	});
});
