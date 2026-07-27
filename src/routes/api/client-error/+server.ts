import { error, json } from '@sveltejs/kit';
import { reportError } from '$lib/server/alerts';
import { clientIp } from '$lib/server/client-ip';
import { createRateLimiter } from '$lib/server/rate-limit';
import type { RequestHandler } from './$types';

/**
 * Anyone can POST here — that's unavoidable for browser error reporting — so
 * the limits below are what stop it being a way to fill the volume or spam the
 * Discord channel. They're per-process and reset when Fly stops the machine,
 * which is fine: so does any burst that was in progress.
 *
 * The shared ceiling is safe here in a way it wouldn't be on a login: the worst
 * an attacker achieves by spending it is that some genuine browser errors go
 * unreported, and nobody is locked out of anything.
 */
const limiter = createRateLimiter({
	limit: 5,
	windowMs: 10 * 60 * 1000,
	globalLimit: 100,
	globalWindowMs: 60 * 60 * 1000
});

/** A stack trace that doesn't fit in 8kb isn't one anybody is going to read. */
const MAX_BODY = 8 * 1024;

export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event);
	if (!limiter.allow(ip, Date.now())) throw error(429, 'Too many reports');

	const raw = await event.request.text();
	if (raw.length > MAX_BODY) throw error(413, 'Report too large');

	let payload: { message?: unknown; stack?: unknown; route?: unknown };
	try {
		payload = JSON.parse(raw);
	} catch {
		throw error(400, 'Malformed report');
	}

	const message = typeof payload.message === 'string' ? payload.message.trim() : '';
	if (!message) throw error(400, 'Report needs a message');

	reportError({
		source: 'client',
		message,
		stack: typeof payload.stack === 'string' ? payload.stack : null,
		route: typeof payload.route === 'string' ? payload.route.slice(0, 200) : null
	});

	return json({ status: 'recorded' }, { status: 202 });
};
