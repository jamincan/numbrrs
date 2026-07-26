/**
 * Cap on any single request to a league API. Without it, an upstream that
 * accepts the connection but never responds would leave a sync job in flight
 * forever — and every later visitor would join that hung job instead of
 * starting a fresh one, serving stale data until the process restarts.
 */
const FETCH_TIMEOUT = 10_000;

export function fetchWithTimeout(url: string): Promise<Response> {
	return fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT) });
}
