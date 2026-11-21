import { createHmac, timingSafeEqual } from 'node:crypto';
import { ADMIN_TOKEN } from '$app/env/private';
import type { Cookies } from '@sveltejs/kit';

export const ADMIN_COOKIE = 'numbrrs_admin';

/** A month. Long enough not to be a chore, short enough that a stolen cookie expires. */
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Constant-time comparison, so response timing doesn't leak how much of a
 * guessed token matched. Lengths must match for timingSafeEqual; comparing
 * them first leaks only the token's length, which isn't a secret worth keeping.
 */
export function tokenMatches(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Shorter than this and the token is within reach of guessing. The documented
 * way to make one (`openssl rand -hex 32`) gives 64 characters.
 */
export const MIN_TOKEN_LENGTH = 32;

/**
 * What to say at boot about a token that is set but too short, or null if there
 * is nothing to say. A warning rather than a refusal: locking the owner out of
 * their own dashboard over a weak token would be a worse outage than the token.
 */
export function weakTokenWarning(token: string | undefined): string | null {
	if (!token || token.length >= MIN_TOKEN_LENGTH) return null;
	return `[admin] ADMIN_TOKEN is ${token.length} characters; use at least ${MIN_TOKEN_LENGTH} (openssl rand -hex 32)`;
}

/**
 * The key sessions are signed with: derived from the token, never the token
 * itself. The token is also the password typed into the login form, and one
 * secret doing two jobs means anything learned about it through one is learned
 * about the other. The label is versioned so the scheme can change later
 * without a cookie from the old one verifying under the new.
 */
function sessionKey(secret: string): Buffer {
	return createHmac('sha256', secret).update('session-v1').digest();
}

function sign(payload: string, secret: string): string {
	return createHmac('sha256', sessionKey(secret)).update(payload).digest('hex');
}

/**
 * The session cookie carries an expiry and a signature over it — never the
 * token itself. If the cookie ever leaks it grants access until it expires and
 * nothing more; it can't be turned back into the secret. Rotating ADMIN_TOKEN
 * invalidates every outstanding session, which is the logout-everywhere lever.
 */
export function signSession(expiresAt: number, secret: string): string {
	return `${expiresAt}.${sign(`admin:${expiresAt}`, secret)}`;
}

export function verifySession(cookie: string | undefined, secret: string, now: number): boolean {
	if (!cookie) return false;

	const [rawExpiry, signature] = cookie.split('.');
	const expiresAt = Number(rawExpiry);
	if (!Number.isFinite(expiresAt) || !signature) return false;
	if (expiresAt < now) return false;

	return tokenMatches(signature, sign(`admin:${expiresAt}`, secret));
}

export function isAuthenticated(cookies: Cookies): boolean {
	const secret = ADMIN_TOKEN;
	if (!secret) return false;
	return verifySession(cookies.get(ADMIN_COOKIE), secret, Date.now());
}

export function startSession(cookies: Cookies, url: URL): void {
	const secret = ADMIN_TOKEN;
	if (!secret) return;

	const expiresAt = Date.now() + SESSION_MAX_AGE * 1000;
	cookies.set(ADMIN_COOKIE, signSession(expiresAt, secret), {
		path: '/admin',
		httpOnly: true,
		sameSite: 'strict',
		// Secure whenever the page came over HTTPS, so plain-http local dev still
		// works. Fly forces HTTPS, so in production this is always on.
		secure: url.protocol === 'https:',
		maxAge: SESSION_MAX_AGE
	});
}

export function endSession(cookies: Cookies): void {
	cookies.delete(ADMIN_COOKIE, { path: '/admin' });
}

/**
 * Small delay on a failed login. Not a real defence — the token is 32 random
 * bytes and nobody is brute-forcing that — but it makes a scripted attempt
 * against the form pointless rather than merely futile.
 */
export function loginDelay(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 400));
}
