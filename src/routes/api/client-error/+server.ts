import { error, json } from '@sveltejs/kit';
import { reportError } from '$lib/server/alerts';
import type { RequestHandler } from './$types';

/**
 * Anyone can POST here — that's unavoidable for browser error reporting — so
 * the limits below are what stop it being a way to fill the volume or spam the
 * Discord channel. They're per-process and reset when Fly stops the machine,
 * which is fine: so does any burst that was in progress.
 */
const PER_IP_LIMIT = 5;
const PER_IP_WINDOW_MS = 10 * 60 * 1000;
const GLOBAL_LIMIT = 100;
const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

/** A stack trace that doesn't fit in 8kb isn't one anybody is going to read. */
const MAX_BODY = 8 * 1024;

const perIp = new Map<string, number[]>();
let globalHits: number[] = [];

function withinLimit(ip: string, now: number): boolean {
	globalHits = globalHits.filter((t) => now - t < GLOBAL_WINDOW_MS);
	if (globalHits.length >= GLOBAL_LIMIT) return false;

	const hits = (perIp.get(ip) ?? []).filter((t) => now - t < PER_IP_WINDOW_MS);
	if (hits.length >= PER_IP_LIMIT) {
		perIp.set(ip, hits);
		return false;
	}

	hits.push(now);
	perIp.set(ip, hits);
	globalHits.push(now);

	// Keep the map from growing without bound on a long-lived machine.
	if (perIp.size > 1000) {
		for (const [key, times] of perIp) {
			if (times.every((t) => now - t >= PER_IP_WINDOW_MS)) perIp.delete(key);
		}
	}

	return true;
}

export const POST: RequestHandler = async (event) => {
	const now = Date.now();
	const ip = event.request.headers.get('fly-client-ip') ?? event.getClientAddress();
	if (!withinLimit(ip, now)) throw error(429, 'Too many reports');

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
