import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from '#lib/site.ts';
import {
	HOME_ROUTE,
	NO_STORE,
	PAGE_CACHE,
	SECURITY_HEADERS,
	applySecurityHeaders,
	cacheControlFor,
	frenchRedirectTarget,
	hostRedirectTarget,
	isAdminPath,
	isAdminRequest,
	isLocaleNegotiated,
	isLocalizedRoute,
	isReportableError,
	requiresAccess
} from './request-policy.ts';

const TEAM_ROUTE = '/[[lang=locale]]/game/[league]/[team]';
const PRIVACY_ROUTE = '/[[lang=locale]]/privacy';

describe('isAdminPath', () => {
	it('covers the admin page and everything under it', () => {
		expect(isAdminPath('/admin')).toBe(true);
		expect(isAdminPath('/admin/')).toBe(true);
		expect(isAdminPath('/admin/__data.json')).toBe(true);
	});

	it('leaves look-alike paths alone', () => {
		expect(isAdminPath('/administrator')).toBe(false);
		expect(isAdminPath('/game/admin')).toBe(false);
		expect(isAdminPath('/')).toBe(false);
	});
});

describe('isAdminRequest', () => {
	it.each([
		// What SvelteKit hands `handle` for each: the route it matched on the
		// decoded path, and the path exactly as the client spelled it.
		['the page', '/admin', '/admin'],
		['one encoded letter', '/admin', '/%61dmin'],
		['another encoded letter', '/admin', '/a%64min'],
		['every letter encoded', '/admin', '/%61%64%6d%69%6e'],
		['an upper-case escape', '/admin', '/%61%64%6D%69%6E'],
		// A route id is enough by itself, whatever the path looks like.
		['a path that resembles nothing', '/admin', '/anything-at-all'],
		['a route beneath it', '/admin/[section]', '/admin/errors']
	])('gates a request that matched the admin route: %s', (_label, routeId, pathname) => {
		expect(isAdminRequest(routeId, pathname)).toBe(true);
	});

	it.each([
		['plain', '/admin/whatever'],
		['a trailing slash', '/admin/'],
		['encoded', '/%61dmin/whatever'],
		['encoded, deeper', '/a%64min/a/b/c'],
		['a non-ASCII tail', '/admin/%E2%9C%93']
	])('gates a path under /admin that matched no route: %s', (_label, pathname) => {
		expect(isAdminRequest(null, pathname)).toBe(true);
	});

	it.each([
		['the home page', HOME_ROUTE, '/'],
		['a team page', TEAM_ROUTE, '/game/nhl/TOR'],
		['an API route', '/api/health', '/api/health'],
		['a look-alike', null, '/administrator'],
		['a look-alike, encoded', null, '/%61dministrator'],
		['admin further down', null, '/game/admin'],
		['a different case', null, '/Admin'],
		// %25 is a literal percent sign to the router, so this is the path
		// "/%61dmin" and not a second spelling of /admin.
		['a double-encoded letter', null, '/%2561dmin'],
		// An encoded slash stays encoded, so this is one odd segment.
		['an encoded separator', null, '/admin%2Fx']
	])('leaves everything else alone: %s', (_label, routeId, pathname) => {
		expect(isAdminRequest(routeId, pathname)).toBe(false);
	});

	it('does not throw on a path that cannot be decoded', () => {
		// SvelteKit answers these with a 400 before any route is involved.
		expect(isAdminRequest(null, '/%zz')).toBe(false);
		expect(isAdminRequest(null, '/%E0%A4%A')).toBe(false);
		// The readable part still counts.
		expect(isAdminRequest(null, '/admin/%zz')).toBe(true);
	});
});

describe('requiresAccess', () => {
	const admin = { routeId: '/admin', pathname: '/admin', dev: false, adminDirect: false };

	it('is required for /admin in production', () => {
		expect(requiresAccess(admin)).toBe(true);
		expect(requiresAccess({ ...admin, pathname: '/%61dmin' })).toBe(true);
		expect(requiresAccess({ ...admin, routeId: null, pathname: '/admin/nothing-here' })).toBe(true);
	});

	it('is waived in dev, which has no Access in front of it', () => {
		expect(requiresAccess({ ...admin, dev: true })).toBe(false);
	});

	it('is waived by the emergency switch', () => {
		expect(requiresAccess({ ...admin, adminDirect: true })).toBe(false);
	});

	it('never applies to the rest of the site', () => {
		expect(requiresAccess({ ...admin, routeId: HOME_ROUTE, pathname: '/' })).toBe(false);
		expect(requiresAccess({ ...admin, routeId: null, pathname: '/administrator' })).toBe(false);
	});
});

describe('hostRedirectTarget', () => {
	it('is null for the hosts the app serves', () => {
		expect(hostRedirectTarget(new URL('https://numbrrs.app/game/nhl/TOR'))).toBeNull();
		expect(hostRedirectTarget(new URL('https://numbrrs.fly.dev/'))).toBeNull();
		expect(hostRedirectTarget(new URL('http://localhost:5173/'))).toBeNull();
	});

	it.each([
		['https://numbrrs.ca/', 'https://numbrrs.app/'],
		['https://www.numbrrs.app/', 'https://numbrrs.app/'],
		['https://numbrrs.ca/game/nhl/TOR', 'https://numbrrs.app/game/nhl/TOR'],
		['https://numbrrs.ca/fr/game/pwhl/MTL?x=1&y=2', 'https://numbrrs.app/fr/game/pwhl/MTL?x=1&y=2'],
		['https://numbrrs.ca/privacy?', 'https://numbrrs.app/privacy'],
		['https://numbrrs.ca/a%20b?q=%2F', 'https://numbrrs.app/a%20b?q=%2F'],
		['http://numbrrs.ca:8080/x', 'https://numbrrs.app/x']
	])('carries the path and query of %s over', (from, to) => {
		expect(hostRedirectTarget(new URL(from))).toBe(to);
	});

	it.each([
		// Each of these, resolved against the origin instead of appended to it,
		// either names another site or cannot be parsed at all.
		'//example.com/',
		'//example.com',
		'///example.com/',
		'/\\example.com/',
		'/\\/example.com/',
		'\\\\example.com/',
		'//example.com:443/path?q=1',
		'//a:b/x',
		'//user:pass@example.com/',
		'/@example.com',
		'//[::1]/',
		'//%65xample.com/',
		'/.example.com',
		'/%2F%2Fexample.com'
	])('stays on the canonical origin for the path %j', (path) => {
		const target = hostRedirectTarget(new URL(`https://numbrrs.ca${path}`));

		expect(target).not.toBeNull();
		expect(target?.startsWith(`${SITE_ORIGIN}/`)).toBe(true);
		// What a browser following the Location header would conclude.
		expect(new URL(target ?? '').origin).toBe(SITE_ORIGIN);
	});

	it('never throws, whatever the path', () => {
		for (const path of ['//a:b/x', '//:/', '//[', '/%', '/%zz', '//\u0000', '//a b/']) {
			expect(() => hostRedirectTarget(new URL(`https://numbrrs.ca${path}`))).not.toThrow();
		}
	});
});

describe('isLocalizedRoute', () => {
	it('is true for pages and false for everything else', () => {
		expect(isLocalizedRoute(HOME_ROUTE)).toBe(true);
		expect(isLocalizedRoute(TEAM_ROUTE)).toBe(true);
		expect(isLocalizedRoute(PRIVACY_ROUTE)).toBe(true);
		expect(isLocalizedRoute('/admin')).toBe(false);
		expect(isLocalizedRoute('/api/health')).toBe(false);
		expect(isLocalizedRoute('/sitemap.xml')).toBe(false);
		expect(isLocalizedRoute(null)).toBe(false);
	});
});

describe('isLocaleNegotiated', () => {
	it('is true only for a localized page reached without a prefix', () => {
		expect(isLocaleNegotiated(TEAM_ROUTE, undefined)).toBe(true);
		expect(isLocaleNegotiated(TEAM_ROUTE, 'fr')).toBe(false);
		expect(isLocaleNegotiated('/api/health', undefined)).toBe(false);
		expect(isLocaleNegotiated(null, undefined)).toBe(false);
	});
});

describe('frenchRedirectTarget', () => {
	const english = {
		routeId: TEAM_ROUTE,
		lang: undefined,
		cookie: undefined,
		acceptLanguage: 'en-CA,en;q=0.9',
		pathname: '/game/nhl/TOR',
		search: ''
	};
	const french = { ...english, acceptLanguage: 'fr-CA,fr;q=0.9,en;q=0.5' };

	it('leaves an English-speaking visitor where they are', () => {
		expect(frenchRedirectTarget(english)).toBeNull();
		expect(frenchRedirectTarget({ ...english, acceptLanguage: null })).toBeNull();
	});

	it('sends a French-speaking visitor to the same page under /fr', () => {
		expect(frenchRedirectTarget(french)).toBe('/fr/game/nhl/TOR');
		expect(frenchRedirectTarget({ ...french, routeId: PRIVACY_ROUTE, pathname: '/privacy' })).toBe(
			'/fr/privacy'
		);
	});

	it('sends the home page to /fr, not /fr/', () => {
		expect(frenchRedirectTarget({ ...french, routeId: HOME_ROUTE, pathname: '/' })).toBe('/fr');
	});

	it('keeps the query string', () => {
		expect(frenchRedirectTarget({ ...french, search: '?mode=hard&x=1' })).toBe(
			'/fr/game/nhl/TOR?mode=hard&x=1'
		);
		expect(
			frenchRedirectTarget({
				...french,
				routeId: HOME_ROUTE,
				pathname: '/',
				search: '?league=pwhl'
			})
		).toBe('/fr?league=pwhl');
	});

	it('lets an explicit choice beat the browser default, in both directions', () => {
		expect(frenchRedirectTarget({ ...french, cookie: 'en' })).toBeNull();
		expect(frenchRedirectTarget({ ...english, cookie: 'fr' })).toBe('/fr/game/nhl/TOR');
	});

	it('ignores a cookie that is not a locale', () => {
		expect(frenchRedirectTarget({ ...english, cookie: 'de' })).toBeNull();
		expect(frenchRedirectTarget({ ...french, cookie: 'de' })).toBe('/fr/game/nhl/TOR');
	});

	it('never redirects a URL that already names its language', () => {
		expect(
			frenchRedirectTarget({ ...french, lang: 'fr', pathname: '/fr/game/nhl/TOR' })
		).toBeNull();
	});

	it('never redirects anything that is not a page', () => {
		for (const routeId of ['/api/health', '/sitemap.xml', '/admin', null]) {
			expect(frenchRedirectTarget({ ...french, routeId, pathname: '/whatever' })).toBeNull();
		}
	});

	it('always answers with a path on this site', () => {
		// The path comes from the request, so it must not be able to turn the
		// target into another origin. The /fr prefix is what guarantees that.
		for (const pathname of ['//example.com', '/\\example.com', '/@example.com']) {
			const target = frenchRedirectTarget({ ...french, pathname });
			expect(new URL(target ?? '', SITE_ORIGIN).origin).toBe(SITE_ORIGIN);
		}
	});
});

describe('cacheControlFor', () => {
	const teamPage = {
		routeId: TEAM_ROUTE,
		pathname: '/game/nhl/TOR',
		status: 200,
		uncacheable: false,
		setsCookie: false
	};

	it('offers a successful page to shared caches', () => {
		expect(cacheControlFor(teamPage)).toBe(PAGE_CACHE);
		expect(cacheControlFor({ ...teamPage, routeId: PRIVACY_ROUTE, pathname: '/fr/privacy' })).toBe(
			PAGE_CACHE
		);
	});

	it('pins the values a CDN acts on', () => {
		// The Cloudflare Worker keys off `public` and `s-maxage`; changing these
		// changes what it caches, so that should be a deliberate edit here too.
		expect(PAGE_CACHE).toBe('public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
		expect(NO_STORE).toBe('private, no-store');
	});

	it.each([404, 500, 503, 301, 302, 308, 400, 405, 204, 206])(
		'does not offer a %i to shared caches',
		(status) => {
			expect(cacheControlFor({ ...teamPage, status })).toBeNull();
		}
	);

	it('keeps the home page out of shared caches, whatever its status', () => {
		const home = { ...teamPage, routeId: HOME_ROUTE, pathname: '/' };
		expect(cacheControlFor(home)).toBe('private, no-cache');
		expect(cacheControlFor({ ...home, pathname: '/fr' })).toBe('private, no-cache');
		expect(cacheControlFor({ ...home, status: 500 })).toBe('private, no-cache');
	});

	it('never stores /admin, by route or by path', () => {
		const admin = { ...teamPage, routeId: '/admin', pathname: '/admin' };
		expect(cacheControlFor(admin)).toBe(NO_STORE);
		expect(cacheControlFor({ ...admin, pathname: '/%61dmin' })).toBe(NO_STORE);
		expect(cacheControlFor({ ...admin, status: 403 })).toBe(NO_STORE);
		expect(cacheControlFor({ ...admin, routeId: null, pathname: '/admin/nope', status: 404 })).toBe(
			NO_STORE
		);
	});

	it('honours a load that opted its response out', () => {
		expect(cacheControlFor({ ...teamPage, uncacheable: true })).toBe(NO_STORE);
		// Stronger than the home page's own policy, not weaker.
		expect(cacheControlFor({ ...teamPage, routeId: HOME_ROUTE, uncacheable: true })).toBe(NO_STORE);
	});

	it('does not share a response that sets a cookie', () => {
		expect(cacheControlFor({ ...teamPage, setsCookie: true })).toBeNull();
	});

	it('leaves everything that is not a page to set its own policy', () => {
		for (const routeId of ['/api/health', '/sitemap.xml', '/api/client-error', null]) {
			expect(cacheControlFor({ ...teamPage, routeId, pathname: '/x' })).toBeNull();
		}
	});
});

describe('security headers', () => {
	it('covers the set every response is meant to carry', () => {
		expect(Object.fromEntries(SECURITY_HEADERS)).toEqual({
			'X-Content-Type-Options': 'nosniff',
			'Referrer-Policy': 'strict-origin-when-cross-origin',
			'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
			'Cross-Origin-Opener-Policy': 'same-origin',
			'Strict-Transport-Security': 'max-age=31536000'
		});
	});

	it('stamps all of them, replacing rather than doubling an existing value', () => {
		const headers = new Headers({ 'x-content-type-options': 'something-else', etag: '"abc"' });

		applySecurityHeaders(headers);

		for (const [name, value] of SECURITY_HEADERS) expect(headers.get(name)).toBe(value);
		expect(headers.get('etag')).toBe('"abc"');
	});
});

describe('isReportableError', () => {
	it('reports anything nobody raised on purpose', () => {
		expect(isReportableError('unknown', 500)).toBe(true);
	});

	it.each([
		['app', 500],
		['app', 503],
		['framework', 500],
		['framework', 508]
	])('reports a deliberate server error: %s %i', (kind, status) => {
		expect(isReportableError(kind, status)).toBe(true);
	});

	it.each([
		['app', 404],
		['app', 400],
		['app', 429],
		['app', 499],
		['framework', 404],
		['framework', 405],
		['framework', 400],
		['validation', 400]
	])('stays quiet about a routine one: %s %i', (kind, status) => {
		expect(isReportableError(kind, status)).toBe(false);
	});
});
