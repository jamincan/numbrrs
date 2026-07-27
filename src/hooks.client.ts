import type { HandleClientError } from '@sveltejs/kit';

/**
 * The game runs in the browser, so the failures most likely to break it — a CSP
 * violation, a bundle that didn't parse, a Svelte 5 rune misuse under a
 * specific interaction — never reach the server and leave no trace anywhere.
 * This ships them back so they show up alongside server errors.
 *
 * `keepalive` lets the request outlive the page, which matters because an error
 * is often immediately followed by the visitor closing the tab.
 */
export const handleError: HandleClientError = ({ error, event, status, message }) => {
	if (status === 404) return { message };

	try {
		fetch('/api/client-error', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			keepalive: true,
			body: JSON.stringify({
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : null,
				route: event.route?.id ?? location.pathname
			})
		}).catch(() => {
			// Reporting the failure to report would be a loop with no exit.
		});
	} catch {
		// Ditto.
	}

	return { message };
};
