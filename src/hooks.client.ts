import type { HandleClientError } from '@sveltejs/kit/hooks';
import { page } from '$app/state';

/**
 * The game runs in the browser, so the failures most likely to break it — a CSP
 * violation, a bundle that didn't parse, a Svelte 5 rune misuse under a
 * specific interaction — never reach the server and leave no trace anywhere.
 * This ships them back so they show up alongside server errors.
 *
 * `keepalive` lets the request outlive the page, which matters because an error
 * is often immediately followed by the visitor closing the tab.
 */

const ENDPOINT = '/api/client-error';

/**
 * Reports per page load. A fault in something that runs every frame or on every
 * keystroke would otherwise send one each time, and the first few already say
 * everything the rest would. The endpoint has its own limit; this one keeps a
 * broken page from spending it.
 */
const MAX_REPORTS = 3;

/**
 * Kept under the endpoint's 8kb body limit with room for JSON escaping. Its
 * route limit is 200 and it stores less of the message and stack than this.
 */
const MAX_MESSAGE = 500;
const MAX_STACK = 4000;
const MAX_ROUTE = 200;

/** Messages already sent from this page load. */
const reported = new Set<string>();

function report(message: string, stack: string | null, route: string | null): void {
	// Nothing in here may surface as an error: a failure to report that reported
	// itself would be a loop with no exit. Hence the catch on both the call and
	// the promise, and the listeners below skipping anything about ENDPOINT.
	try {
		const key = message.slice(0, MAX_MESSAGE);
		if (!key || reported.size >= MAX_REPORTS || reported.has(key)) return;
		reported.add(key);

		fetch(ENDPOINT, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			keepalive: true,
			body: JSON.stringify({
				message: key,
				stack: stack === null ? null : stack.slice(0, MAX_STACK),
				// The route id rather than the path where there is one, so the same
				// fault on two teams' pages is one error and not two.
				route: (route ?? page.route.id ?? location.pathname).slice(0, MAX_ROUTE)
			})
		}).catch(() => {});
	} catch {
		// See above.
	}
}

/**
 * Other people's code. An extension injects scripts into the page and their
 * failures arrive on the page's own `window`; nothing here can fix them.
 */
const EXTENSION = /\b(?:chrome|moz|safari|safari-web)-extension:\/\//;

function fromExtension(...sources: unknown[]): boolean {
	return sources.some((source) => typeof source === 'string' && EXTENSION.test(source));
}

function stackOf(value: unknown): string | null {
	return value instanceof Error && typeof value.stack === 'string' ? value.stack : null;
}

function messageOf(value: unknown): string {
	if (value instanceof Error) return value.message || value.name;
	try {
		return String(value);
	} catch {
		return 'unprintable value';
	}
}

export const handleError: HandleClientError = ({ kind, error, event }) => {
	// A 404 or an error(4xx) from a load is the app working as intended. What is
	// worth reporting is an error nobody raised on purpose, and a deliberate 5xx,
	// which is the app saying that something behind it is broken.
	if (kind !== 'unknown') {
		if (error.status < 500) return;
		report(`${error.status}: ${error.message}`, null, event.route.id);
		return;
	}

	report(messageOf(error), stackOf(error), event.route.id);
};

// SvelteKit only passes `handleError` what goes wrong while it is loading or
// rendering a route. An exception in an event handler, a timer or an effect, a
// promise nobody awaited and anything the CSP refuses all happen outside that,
// and are most of what can break a game that runs entirely in the browser.

window.addEventListener('error', (event) => {
	const { filename, error } = event;
	// Checked rather than assumed: a script can dispatch a bare `error` event of
	// its own, and a listener that threw on one would be reporting itself.
	const message = typeof event.message === 'string' ? event.message : '';
	// All a browser will say about a failure in a script from another origin.
	// There is nothing in it to act on.
	if (message === 'Script error.' || message === 'Script error') return;
	// A notice that a resize callback ran out of frame, not a failure: the
	// browser delivers the rest on the next one.
	if (message.startsWith('ResizeObserver loop')) return;
	if (fromExtension(filename, stackOf(error))) return;

	// `error` is whatever was thrown, which need not be an Error; the event's
	// own message is then all there is.
	report(error instanceof Error ? messageOf(error) : message, stackOf(error), null);
});

window.addEventListener('unhandledrejection', (event) => {
	const { reason } = event;
	if (fromExtension(stackOf(reason))) return;

	report(
		reason instanceof Error ? messageOf(reason) : `Unhandled rejection: ${messageOf(reason)}`,
		stackOf(reason),
		null
	);
});

/**
 * Where a blocked request was headed, without the path or query: the full URL
 * of something an extension or an injected script tried to load can carry
 * whatever that script put in it. Not always a URL — the browser reports
 * `inline` and `eval` as bare keywords.
 */
function blockedTarget(uri: string): string {
	try {
		const url = new URL(uri);
		// `data:` and `blob:` have no origin to speak of; the scheme is the fact.
		return url.origin === 'null' ? url.protocol : url.origin;
	} catch {
		return /^[a-z-]+$/.test(uri) ? uri : 'unknown';
	}
}

document.addEventListener('securitypolicyviolation', (event) => {
	const blockedURI = typeof event.blockedURI === 'string' ? event.blockedURI : '';
	if (fromExtension(blockedURI, event.sourceFile)) return;
	// If the policy ever blocked the report itself, reporting that would be the
	// one report certain not to arrive.
	if (blockedURI.includes(ENDPOINT)) return;

	const directive = event.effectiveDirective || event.violatedDirective;
	report(`CSP violation: ${directive} blocked ${blockedTarget(blockedURI)}`, null, null);
});
