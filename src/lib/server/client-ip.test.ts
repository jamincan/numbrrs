import { describe, expect, it } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { clientIp } from './client-ip';

/** A Cloudflare edge address, per the ranges in ./cloudflare-ips. */
const CLOUDFLARE_EDGE = '172.68.1.1';
const VISITOR = '203.0.113.9';

function eventWith(
	headers: Record<string, string>,
	getClientAddress: () => string = () => '127.0.0.1'
): RequestEvent {
	return {
		request: new Request('https://numbrrs.app/', { headers }),
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
});
