import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { clientIp, visitorKey } from './client-ip';

/** A Cloudflare edge address, per the ranges in ./cloudflare-ips. */
const CLOUDFLARE_EDGE = '172.68.1.1';
const VISITOR = '203.0.113.9';

function eventWith(
	headers: Record<string, string>,
	getClientAddress: () => string = () => '127.0.0.1',
	origin = 'https://numbrrs.app'
): RequestEvent {
	const url = new URL('/', origin);
	return {
		url,
		request: new Request(url, { headers }),
		getClientAddress
	} as unknown as RequestEvent;
}

describe('clientIp', () => {
	it('believes CF-Connecting-IP when Cloudflare is the hop that delivered it', () => {
		const ip = clientIp(
			eventWith({ 'fly-client-ip': CLOUDFLARE_EDGE, 'cf-connecting-ip': VISITOR })
		);

		expect(ip).toBe(VISITOR);
	});

	it('ignores a forged CF-Connecting-IP on a direct hit to the Fly hostname', () => {
		// The bypass this function exists to close: anyone can reach
		// numbrrs.fly.dev and send whatever header they like. Trusting it would
		// hand out a fresh rate-limit bucket per request.
		const attacker = '198.51.100.7';
		const ip = clientIp(eventWith({ 'fly-client-ip': attacker, 'cf-connecting-ip': VISITOR }));

		expect(ip).toBe(attacker);
	});

	it('does not let a forged header change the answer at all', () => {
		const attacker = '198.51.100.7';
		const headers = { 'fly-client-ip': attacker };

		// Same address either way, so spoofing buys nothing.
		expect(clientIp(eventWith(headers))).toBe(
			clientIp(eventWith({ ...headers, 'cf-connecting-ip': '1.2.3.4' }))
		);
	});

	it('ignores CF-Connecting-IP from a Cloudflare address that is not asking for the canonical host', () => {
		// Somebody else's Worker fetching the Fly hostname: a genuine Cloudflare
		// address on the hop, and a header that Worker wrote itself.
		for (const origin of ['https://numbrrs.fly.dev', 'https://attacker.example']) {
			const ip = clientIp(
				eventWith(
					{ 'fly-client-ip': CLOUDFLARE_EDGE, 'cf-connecting-ip': VISITOR },
					undefined,
					origin
				)
			);
			expect(ip).toBe(CLOUDFLARE_EDGE);
		}
	});

	it('ignores a CF-Connecting-IP that is not an address', () => {
		for (const junk of ['not-an-ip', '203.0.113.9, 10.0.0.1', '203.0.113.9\tx', '999.1.1.1', '']) {
			const ip = clientIp(
				eventWith({ 'fly-client-ip': CLOUDFLARE_EDGE, 'cf-connecting-ip': junk })
			);
			expect(ip).toBe(CLOUDFLARE_EDGE);
		}
	});

	it('keys an IPv6 visitor on their /64, whichever header named them', () => {
		const viaCloudflare = (address: string) =>
			clientIp(eventWith({ 'fly-client-ip': CLOUDFLARE_EDGE, 'cf-connecting-ip': address }));

		// Two addresses out of the one block a provider gave one customer.
		expect(viaCloudflare('2001:db8:aa:bb:1:2:3:4')).toBe('2001:db8:aa:bb::/64');
		expect(viaCloudflare('2001:db8:aa:bb:ffff:ffff:ffff:ffff')).toBe('2001:db8:aa:bb::/64');
		// The neighbouring block is somebody else.
		expect(viaCloudflare('2001:db8:aa:bc::1')).toBe('2001:db8:aa:bc::/64');

		expect(clientIp(eventWith({ 'fly-client-ip': '2001:db8:aa:bb::9' }))).toBe(
			'2001:db8:aa:bb::/64'
		);
	});

	it('falls back to Fly when Cloudflare sends no CF-Connecting-IP', () => {
		expect(clientIp(eventWith({ 'fly-client-ip': CLOUDFLARE_EDGE }))).toBe(CLOUDFLARE_EDGE);
	});

	it('uses X-Forwarded-For only off Fly, taking the first entry', () => {
		expect(clientIp(eventWith({ 'x-forwarded-for': `${VISITOR}, 10.0.0.1` }))).toBe(VISITOR);
	});

	it('falls back to the socket address when no header says otherwise', () => {
		expect(clientIp(eventWith({}, () => '10.1.2.3'))).toBe('10.1.2.3');
	});

	it('never throws, even when the address is unavailable', () => {
		const ip = clientIp(
			eventWith({}, () => {
				throw new Error('prerendering');
			})
		);

		expect(ip).toBe('unknown');
	});

	it('still identifies a local visitor with neither Fly nor Cloudflare in front', () => {
		// Dev and the e2e server: localhost, no proxy headers at all.
		const local = (address: string) =>
			clientIp(eventWith({}, () => address, 'http://localhost:4173'));

		expect(local('127.0.0.1')).toBe('127.0.0.1');
		// What Node reports for an IPv4 client on a dual-stack socket.
		expect(local('::ffff:127.0.0.1')).toBe('127.0.0.1');
		expect(local('::1')).toBe('0:0:0:0::/64');
	});
});

describe('visitorKey', () => {
	it('leaves an IPv4 address as it is', () => {
		expect(visitorKey('203.0.113.9')).toBe('203.0.113.9');
	});

	it('gives every spelling of one /64 the same key', () => {
		const key = '2001:db8:0:1::/64';
		for (const address of [
			'2001:db8:0:1::',
			'2001:db8:0:1::1',
			'2001:0db8:0000:0001:0000:0000:0000:0001',
			'2001:DB8:0:1:a:b:c:d',
			'2001:db8:0:1:a:b:192.0.2.1',
			'2001:db8:0:1::1%eth0'
		]) {
			expect(visitorKey(address)).toBe(key);
		}
	});

	it('expands a leading or trailing gap correctly', () => {
		expect(visitorKey('::')).toBe('0:0:0:0::/64');
		expect(visitorKey('::2:3:4:5:6:7:8')).toBe('0:2:3:4::/64');
		expect(visitorKey('1:2:3:4:5:6:7::')).toBe('1:2:3:4::/64');
		expect(visitorKey('fe80::1')).toBe('fe80:0:0:0::/64');
	});

	it('unwraps an IPv4 address dressed as IPv6 rather than pooling them all', () => {
		expect(visitorKey('::ffff:203.0.113.9')).toBe('203.0.113.9');
		expect(visitorKey('::ffff:cb00:7109')).toBe('203.0.113.9');
		expect(visitorKey('::ffff:198.51.100.7')).not.toBe(visitorKey('::ffff:203.0.113.9'));
	});

	it('returns anything that is not an address untouched', () => {
		for (const odd of ['unknown', '', 'localhost', '1.2.3', ':::', '2001:db8::1::2']) {
			expect(visitorKey(odd)).toBe(odd);
		}
	});
});
