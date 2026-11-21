import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// hooks.client.ts attaches its listeners when it is imported and expects a
// browser. There is no DOM in this test environment, so `window` and `document`
// are plain EventTargets and events are ordinary Events carrying the fields a
// browser would set — which is all the module reads.
vi.mock('$app/state', () => ({ page: { route: { id: '/[[lang=locale]]/game/[league]/[team]' } } }));

type Hooks = typeof import('./hooks.client');
type CaughtInput = Parameters<Hooks['handleError']>[0];

let hooks: Hooks;
let fetchMock: Mock<(url: string, init: RequestInit) => Promise<Response>>;
let win: EventTarget;
let doc: EventTarget;

function dispatch(target: EventTarget, type: string, fields: Record<string, unknown>): void {
	target.dispatchEvent(Object.assign(new Event(type), fields));
}

function sent(): { message: string; stack: string | null; route: string }[] {
	return fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
}

function navigationEvent(routeId: string | null = '/admin'): CaughtInput['event'] {
	return { route: { id: routeId } } as CaughtInput['event'];
}

beforeEach(async () => {
	// A fresh import each time: the cap and the seen-messages set last for a page
	// load, which here means for one copy of the module.
	vi.resetModules();
	win = new EventTarget();
	doc = new EventTarget();
	fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
	vi.stubGlobal('window', win);
	vi.stubGlobal('document', doc);
	vi.stubGlobal('location', { pathname: '/game/nhl/TOR' });
	vi.stubGlobal('fetch', fetchMock);
	hooks = await import('./hooks.client');
});

describe('handleError', () => {
	it('reports an error nobody raised on purpose, with the route id', () => {
		const error = new Error('x is not a function');

		void hooks.handleError({ kind: 'unknown', error, event: navigationEvent() });

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0]!;
		expect(url).toBe('/api/client-error');
		expect(init).toMatchObject({ method: 'POST', keepalive: true });
		expect(sent()[0]).toEqual({
			message: 'x is not a function',
			stack: error.stack,
			route: '/admin'
		});
	});

	it('skips a 404 and a deliberate 4xx', () => {
		void hooks.handleError({
			kind: 'framework',
			error: { status: 404, message: 'Not Found' },
			event: navigationEvent()
		});
		void hooks.handleError({
			kind: 'app',
			error: { status: 404, message: 'Team not found' },
			event: navigationEvent()
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reports a deliberate 5xx', () => {
		void hooks.handleError({
			kind: 'app',
			error: { status: 503, message: 'Roster unavailable' },
			event: navigationEvent()
		});

		expect(sent()).toEqual([{ message: '503: Roster unavailable', stack: null, route: '/admin' }]);
	});
});

describe('window errors', () => {
	it('reports an uncaught exception against the current route id', () => {
		const error = new TypeError('cards is undefined');

		dispatch(win, 'error', { message: 'Uncaught TypeError: cards is undefined', error });

		expect(sent()).toEqual([
			{
				message: 'cards is undefined',
				stack: error.stack,
				route: '/[[lang=locale]]/game/[league]/[team]'
			}
		]);
	});

	it('reports an unhandled rejection, whatever was rejected with', () => {
		const error = new Error('Failed to fetch dynamically imported module: https://x/a.js');

		dispatch(win, 'unhandledrejection', { reason: error });
		dispatch(win, 'unhandledrejection', { reason: 'nope' });

		expect(sent().map((report) => report.message)).toEqual([
			'Failed to fetch dynamically imported module: https://x/a.js',
			'Unhandled rejection: nope'
		]);
	});

	it('ignores the opaque cross-origin "Script error."', () => {
		dispatch(win, 'error', { message: 'Script error.', filename: '', error: null });

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it.each(['chrome-extension', 'moz-extension', 'safari-extension', 'safari-web-extension'])(
		'ignores errors from a %s script',
		(scheme) => {
			const error = new Error('extension broke');
			error.stack = `Error: extension broke\n    at inject (${scheme}://abcdef/content.js:1:1)`;

			dispatch(win, 'error', { message: 'x', filename: `${scheme}://abcdef/content.js` });
			dispatch(win, 'error', { message: 'y', filename: '', error });
			dispatch(win, 'unhandledrejection', { reason: error });
			dispatch(doc, 'securitypolicyviolation', {
				effectiveDirective: 'script-src-elem',
				blockedURI: 'inline',
				sourceFile: `${scheme}://abcdef/content.js`
			});

			expect(fetchMock).not.toHaveBeenCalled();
		}
	);

	it('does not throw on a bare event with none of the usual fields', () => {
		expect(() => {
			dispatch(win, 'error', {});
			dispatch(win, 'unhandledrejection', {});
			dispatch(doc, 'securitypolicyviolation', {});
		}).not.toThrow();
	});
});

describe('CSP violations', () => {
	it('reports the directive and only the origin of what was blocked', () => {
		dispatch(doc, 'securitypolicyviolation', {
			effectiveDirective: 'connect-src',
			blockedURI: 'https://tracker.example/collect?user=someone&token=abc',
			sourceFile: 'https://numbrrs.app/_app/immutable/chunks/a.js'
		});

		expect(sent()[0]?.message).toBe('CSP violation: connect-src blocked https://tracker.example');
		expect(JSON.stringify(sent())).not.toContain('token');
	});

	it('keeps the bare keywords and schemes a browser reports instead of a URL', () => {
		dispatch(doc, 'securitypolicyviolation', {
			effectiveDirective: 'style-src-elem',
			blockedURI: 'inline'
		});
		dispatch(doc, 'securitypolicyviolation', {
			effectiveDirective: 'img-src',
			blockedURI: 'blob:https://numbrrs.app/3f1c'
		});
		dispatch(doc, 'securitypolicyviolation', {
			effectiveDirective: 'font-src',
			blockedURI: 'data:font/woff2;base64,AAAA'
		});

		expect(sent().map((report) => report.message)).toEqual([
			'CSP violation: style-src-elem blocked inline',
			'CSP violation: img-src blocked https://numbrrs.app',
			'CSP violation: font-src blocked data:'
		]);
	});

	it('does not report a violation about the report endpoint itself', () => {
		dispatch(doc, 'securitypolicyviolation', {
			effectiveDirective: 'connect-src',
			blockedURI: 'https://numbrrs.app/api/client-error'
		});

		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('limits', () => {
	it('sends an identical message once per page load', () => {
		for (let i = 0; i < 10; i++) {
			dispatch(win, 'error', { message: 'same', error: new Error('same') });
		}

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('stops after three reports, whichever listener they came from', () => {
		dispatch(win, 'error', { message: 'one', error: new Error('one') });
		dispatch(win, 'unhandledrejection', { reason: new Error('two') });
		dispatch(doc, 'securitypolicyviolation', { effectiveDirective: 'img-src', blockedURI: 'eval' });
		dispatch(win, 'error', { message: 'four', error: new Error('four') });
		void hooks.handleError({ kind: 'unknown', error: new Error('five'), event: navigationEvent() });

		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('keeps the payload inside what the endpoint accepts', () => {
		const error = new Error('m'.repeat(5000));
		error.stack = 's'.repeat(50_000);
		vi.stubGlobal('location', { pathname: `/${'p'.repeat(1000)}` });

		void hooks.handleError({ kind: 'unknown', error, event: navigationEvent(null) });

		const body = String(fetchMock.mock.calls[0]![1].body);
		expect(body.length).toBeLessThan(8 * 1024);
		expect(sent()[0]?.message).toHaveLength(500);
	});

	it('does not report its own failure to report', async () => {
		// Left unhandled, this rejection would fail the run: Vitest treats an
		// unhandled rejection in a test as an error.
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

		dispatch(win, 'error', { message: 'boom', error: new Error('boom') });
		await new Promise((resolve) => setImmediate(resolve));

		expect(fetchMock).toHaveBeenCalledTimes(1);

		// And a fetch that throws outright, rather than rejecting, is swallowed too.
		fetchMock.mockImplementation(() => {
			throw new Error('fetch is broken');
		});
		expect(() =>
			dispatch(win, 'error', { message: 'again', error: new Error('again') })
		).not.toThrow();
	});
});
