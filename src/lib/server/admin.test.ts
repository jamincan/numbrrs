import { describe, expect, it } from 'vitest';
import { signSession, tokenMatches, verifySession } from './admin';

const SECRET = 'a-long-random-admin-token';
const NOW = Date.UTC(2026, 6, 27, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

describe('tokenMatches', () => {
	it('accepts an exact match', () => {
		expect(tokenMatches(SECRET, SECRET)).toBe(true);
	});

	it('rejects a wrong token', () => {
		expect(tokenMatches('nope', SECRET)).toBe(false);
	});

	it('rejects a correct prefix of the right length-mismatch', () => {
		expect(tokenMatches(SECRET.slice(0, 10), SECRET)).toBe(false);
		expect(tokenMatches(`${SECRET}extra`, SECRET)).toBe(false);
	});
});

describe('session cookies', () => {
	it('accepts a cookie it just signed', () => {
		const cookie = signSession(NOW + HOUR, SECRET);
		expect(verifySession(cookie, SECRET, NOW)).toBe(true);
	});

	it('never contains the token itself', () => {
		expect(signSession(NOW + HOUR, SECRET)).not.toContain(SECRET);
	});

	it('rejects an expired cookie', () => {
		const cookie = signSession(NOW - HOUR, SECRET);
		expect(verifySession(cookie, SECRET, NOW)).toBe(false);
	});

	it('rejects a cookie whose expiry was extended by hand', () => {
		const cookie = signSession(NOW + HOUR, SECRET);
		const signature = cookie.split('.')[1];
		const forged = `${NOW + 100 * HOUR}.${signature}`;
		expect(verifySession(forged, SECRET, NOW)).toBe(false);
	});

	it('rejects a cookie signed with a different secret', () => {
		const cookie = signSession(NOW + HOUR, 'some-other-token');
		expect(verifySession(cookie, SECRET, NOW)).toBe(false);
	});

	it('rejects missing and malformed cookies', () => {
		expect(verifySession(undefined, SECRET, NOW)).toBe(false);
		expect(verifySession('', SECRET, NOW)).toBe(false);
		expect(verifySession('garbage', SECRET, NOW)).toBe(false);
		expect(verifySession('notanumber.abc123', SECRET, NOW)).toBe(false);
		expect(verifySession(`${NOW + HOUR}.`, SECRET, NOW)).toBe(false);
	});

	it('invalidates every outstanding session when the token is rotated', () => {
		const cookie = signSession(NOW + 30 * 24 * HOUR, SECRET);
		expect(verifySession(cookie, SECRET, NOW)).toBe(true);
		expect(verifySession(cookie, 'rotated-token', NOW)).toBe(false);
	});
});
