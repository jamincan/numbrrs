import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/**
 * Cloudflare Access guards numbrrs.app/admin, but Access only sees traffic that
 * passes through Cloudflare. numbrrs.fly.dev reaches the app directly, and so
 * does anyone who connects straight to Fly while naming numbrrs.app, since Fly
 * holds that certificate too. Checking the hostname wouldn't stop that, and
 * neither would checking that a request came from a Cloudflare address: anyone
 * can point their own Cloudflare zone at this origin.
 *
 * What does work is the signed token Access attaches to every request it lets
 * through. Only Access can issue one for this application, so /admin requires
 * it (see `requiresAccess` in request-policy.ts for which requests that covers,
 * and `handle` in hooks.server.ts for the check). ADMIN_DIRECT in src/env.ts switches the
 * requirement off for when Cloudflare itself is down.
 *
 * Neither value is secret: both appear in Cloudflare's own login redirect.
 */
export const ACCESS_TEAM_DOMAIN = 'https://proud-brook-b283.cloudflareaccess.com';
/** The Access application's audience (AUD) tag. */
export const ACCESS_AUD = '9f8608f8bbbaaa2555afd7b5ba6b35d0ebfe1a550fb39fd85a19be59e7009a91';

/** Access forwards its token in this header, and also leaves it in this cookie. */
export const ACCESS_HEADER = 'cf-access-jwt-assertion';
export const ACCESS_COOKIE = 'CF_Authorization';

// The team's public keys, fetched on first use and cached. A token signed with a
// key the cache doesn't know prompts a refetch, which is how Access's key
// rotation is picked up.
const teamKeys = createRemoteJWKSet(new URL('/cdn-cgi/access/certs', ACCESS_TEAM_DOMAIN));

export type AccessResult = { ok: true } | { ok: false; reason: string };

/**
 * Check that a token was signed with the team's keys, issued by the team, meant
 * for this application, and is still current. `keys` is only for tests.
 */
export async function verifyAccessToken(
	token: string | null | undefined,
	keys: JWTVerifyGetKey = teamKeys
): Promise<AccessResult> {
	if (!token) return { ok: false, reason: 'no Access token' };
	try {
		await jwtVerify(token, keys, {
			issuer: ACCESS_TEAM_DOMAIN,
			audience: ACCESS_AUD,
			algorithms: ['RS256'],
			// jose only checks an expiry that is present, and a token without one
			// would otherwise be good forever.
			requiredClaims: ['exp'],
			// Fly's clock and Cloudflare's can disagree by a moment, and a token that
			// looks a second early shouldn't lock the admin out.
			clockTolerance: 30
		});
		return { ok: true };
	} catch (err) {
		// The reason goes to the log, where "unexpected aud" versus "no token" is
		// the difference between a misconfiguration and a stranger.
		return { ok: false, reason: err instanceof Error ? err.message : String(err) };
	}
}
