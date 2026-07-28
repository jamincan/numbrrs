import { describe, expect, it } from 'vitest';
import {
	dayKey,
	fingerprintOf,
	isBot,
	normalizeMessage,
	referrerHost,
	truncate,
	visitorHash
} from './telemetry';

describe('dayKey', () => {
	it('formats as a sortable YYYY-MM-DD', () => {
		expect(dayKey(Date.UTC(2026, 6, 27, 16, 0, 0))).toBe('2026-07-27');
	});

	it('buckets by the app timezone, not UTC', () => {
		// 01:30 UTC on the 28th is still the evening of the 27th in Toronto.
		// Bucketing by UTC would move an evening's traffic onto the next day.
		expect(dayKey(Date.UTC(2026, 6, 28, 1, 30, 0))).toBe('2026-07-27');
	});
});

describe('isBot', () => {
	it('lets real browsers through', () => {
		const chrome =
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
		const iphone =
			'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
		expect(isBot(chrome)).toBe(false);
		expect(isBot(iphone)).toBe(false);
	});

	it('catches crawlers, previewers and scripts', () => {
		for (const ua of [
			'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
			'Mozilla/5.0 (compatible; bingbot/2.0)',
			'facebookexternalhit/1.1',
			'curl/8.4.0',
			'python-requests/2.31.0',
			'Mozilla/5.0 (compatible; AhrefsBot/7.0)'
		]) {
			expect(isBot(ua), ua).toBe(true);
		}
	});

	it('treats a missing user agent as a bot', () => {
		expect(isBot('')).toBe(true);
		expect(isBot('   ')).toBe(true);
	});
});

describe('visitorHash', () => {
	const salt = Buffer.from('a-days-salt');

	it('is stable for the same visitor within a day', () => {
		const a = visitorHash(salt, '2026-07-27', '1.2.3.4', 'Chrome');
		const b = visitorHash(salt, '2026-07-27', '1.2.3.4', 'Chrome');
		expect(a).toBe(b);
	});

	it('separates different visitors', () => {
		const a = visitorHash(salt, '2026-07-27', '1.2.3.4', 'Chrome');
		const b = visitorHash(salt, '2026-07-27', '5.6.7.8', 'Chrome');
		expect(a).not.toBe(b);
	});

	it('cannot be linked across days once the salt rotates', () => {
		const today = visitorHash(Buffer.from('salt-one'), '2026-07-27', '1.2.3.4', 'Chrome');
		const tomorrow = visitorHash(Buffer.from('salt-two'), '2026-07-28', '1.2.3.4', 'Chrome');
		expect(today).not.toBe(tomorrow);
	});

	it('does not leak the address it was built from', () => {
		expect(visitorHash(salt, '2026-07-27', '1.2.3.4', 'Chrome')).not.toContain('1.2.3.4');
	});
});

describe('referrerHost', () => {
	const own = ['numbrrs.app', 'numbrrs.fly.dev'];

	it('keeps only the host', () => {
		expect(referrerHost('https://discord.com/channels/123/456', own)).toBe('discord.com');
	});

	it('drops our own hosts so internal navigation is not a referrer', () => {
		expect(referrerHost('https://numbrrs.app/fr/game/nhl/TOR', own)).toBeNull();
		expect(referrerHost('https://numbrrs.fly.dev/', own)).toBeNull();
	});

	it('handles a missing or unparseable referrer', () => {
		expect(referrerHost(null, own)).toBeNull();
		expect(referrerHost('not a url', own)).toBeNull();
	});
});

describe('normalizeMessage', () => {
	it('collapses varying ids so one bug is one fingerprint', () => {
		expect(normalizeMessage('Team 42 not found')).toBe(normalizeMessage('Team 9137 not found'));
		expect(normalizeMessage('job 6ba7b810-9dad-11d1-80b4-00c04fd430c8 failed')).toBe(
			normalizeMessage('job 6ba7b811-9dad-11d1-80b4-00c04fd430c8 failed')
		);
	});

	it('keeps genuinely different messages apart', () => {
		expect(normalizeMessage('Team not found')).not.toBe(normalizeMessage('Roster fetch failed'));
	});

	it('leaves single digits alone, since those are usually meaningful', () => {
		expect(normalizeMessage('period 3 ended')).toBe('period 3 ended');
	});
});

describe('fingerprintOf', () => {
	it('folds the same failure across teams into one row', () => {
		const a = fingerprintOf('sync', 'Roster sync failed for nhl (transient)', 'sync:roster:nhl');
		const b = fingerprintOf('sync', 'Roster sync failed for nhl (transient)', 'sync:roster:nhl');
		expect(a).toBe(b);
	});

	it('separates leagues, sources and routes', () => {
		const nhl = fingerprintOf('sync', 'Roster sync failed', 'sync:roster:nhl');
		const pwhl = fingerprintOf('sync', 'Roster sync failed', 'sync:roster:pwhl');
		const client = fingerprintOf('client', 'Roster sync failed', 'sync:roster:nhl');
		expect(new Set([nhl, pwhl, client]).size).toBe(3);
	});
});

describe('truncate', () => {
	it('caps long values and marks the cut', () => {
		expect(truncate('x'.repeat(50), 10)).toBe(`${'x'.repeat(10)}…`);
	});

	it('leaves short values untouched', () => {
		expect(truncate('short', 10)).toBe('short');
	});
});
