import { describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';
import { ACCESS_AUD, ACCESS_TEAM_DOMAIN, verifyAccessToken } from './cloudflare-access';

// A stand-in for the team's signing key, published the way Access publishes its
// own, plus a second key nobody trusts.
const team = await generateKeyPair('RS256');
const stranger = await generateKeyPair('RS256');
const keys = createLocalJWKSet({
	keys: [{ ...(await exportJWK(team.publicKey)), kid: 'team-key', alg: 'RS256' }]
});

const now = () => Math.floor(Date.now() / 1000);

/** A token shaped like the ones Access issues, with any part swappable. */
function token(
	overrides: { iss?: string; aud?: string; exp?: number; key?: CryptoKey } = {}
): Promise<string> {
	return new SignJWT({ email: 'admin@example.com' })
		.setProtectedHeader({ alg: 'RS256', kid: 'team-key' })
		.setIssuer(overrides.iss ?? ACCESS_TEAM_DOMAIN)
		.setAudience([overrides.aud ?? ACCESS_AUD])
		.setIssuedAt()
		.setExpirationTime(overrides.exp ?? now() + 3600)
		.sign(overrides.key ?? team.privateKey);
}

describe('verifyAccessToken', () => {
	it('accepts a token Access would issue for this application', async () => {
		expect(await verifyAccessToken(await token(), keys)).toEqual({ ok: true });
	});

	it('refuses a request with no token at all', async () => {
		for (const missing of [undefined, null, '']) {
			expect(await verifyAccessToken(missing, keys)).toEqual({
				ok: false,
				reason: 'no Access token'
			});
		}
	});

	it("refuses a token meant for another of the team's applications", async () => {
		const result = await verifyAccessToken(await token({ aud: 'another-application' }), keys);
		expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('aud') });
	});

	it('refuses a token issued by another team', async () => {
		const result = await verifyAccessToken(
			await token({ iss: 'https://someone-else.cloudflareaccess.com' }),
			keys
		);
		expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('iss') });
	});

	it('refuses an expired token, allowing a little clock drift', async () => {
		expect(await verifyAccessToken(await token({ exp: now() - 120 }), keys)).toMatchObject({
			ok: false
		});
		expect(await verifyAccessToken(await token({ exp: now() - 10 }), keys)).toEqual({ ok: true });
	});

	it('refuses a token that never expires', async () => {
		// Correctly signed, right issuer, right audience — and no `exp` at all,
		// which a verifier that only checks the claim when present waves through.
		const immortal = await new SignJWT({ email: 'admin@example.com' })
			.setProtectedHeader({ alg: 'RS256', kid: 'team-key' })
			.setIssuer(ACCESS_TEAM_DOMAIN)
			.setAudience([ACCESS_AUD])
			.setIssuedAt()
			.sign(team.privateKey);
		expect(await verifyAccessToken(immortal, keys)).toMatchObject({
			ok: false,
			reason: expect.stringContaining('exp')
		});
	});

	it("refuses a token signed with anyone else's key", async () => {
		const forged = await token({ key: stranger.privateKey });
		expect(await verifyAccessToken(forged, keys)).toMatchObject({ ok: false });
	});

	it('refuses a token that swaps in a shared-secret algorithm', async () => {
		const hmac = await new SignJWT({})
			.setProtectedHeader({ alg: 'HS256', kid: 'team-key' })
			.setIssuer(ACCESS_TEAM_DOMAIN)
			.setAudience(ACCESS_AUD)
			.setExpirationTime(now() + 3600)
			.sign(new TextEncoder().encode('not-a-real-secret-but-long-enough-for-hs256'));
		expect(await verifyAccessToken(hmac, keys)).toMatchObject({ ok: false });
	});

	it('refuses something that is not a token', async () => {
		expect(await verifyAccessToken('not.a.token', keys)).toMatchObject({ ok: false });
	});
});
