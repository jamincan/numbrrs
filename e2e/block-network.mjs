/**
 * Preloaded into the server the e2e suite runs against (`node --import`, see
 * playwright.config.ts), so it is in place before any of the app's own modules
 * load.
 *
 * The suite is meant to run entirely off the seeded fixture. The fixture marks
 * everything fresh so that nothing needs fetching, but that only holds while
 * the fixture is complete and seeded in time; this makes "no request leaves the
 * machine" a property of the process instead. A gap in the fixture then shows
 * up as a named, logged failure rather than as a quiet call to a league's API.
 *
 * Only `fetch` is wrapped because it is the only way the server makes outbound
 * requests (the league adapters, the Discord webhook, Cloudflare Access's
 * keys). Code that reached for node:http directly would get past this.
 */

/** URL.hostname keeps the brackets on an IPv6 literal. */
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

const realFetch = globalThis.fetch;

/**
 * @param {string | URL | Request} input
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
function localOnlyFetch(input, init) {
	const url = input instanceof Request ? input.url : String(input);

	let hostname;
	try {
		hostname = new URL(url).hostname;
	} catch {
		// Not an absolute URL, so it can't reach anything; let fetch reject it
		// with its own error.
		return realFetch(input, init);
	}
	if (LOOPBACK.has(hostname)) return realFetch(input, init);

	const message = `[e2e] blocked outbound fetch to ${url}: the e2e server may only reach localhost. If a page needs this data, seed it in e2e/seed.ts.`;
	// Logged as well as thrown: the app catches sync failures by design, so the
	// rejection alone could pass unnoticed. Playwright prints the server's stderr.
	console.error(message);
	return Promise.reject(new Error(message));
}

globalThis.fetch = localOnlyFetch;
