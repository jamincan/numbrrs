import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { reportError } from '#lib/server/alerts.ts';
import { clientIp } from '#lib/server/client-ip.ts';
import { createRateLimiter } from '#lib/server/rate-limit.ts';
import { MAX_ROUTE } from '#lib/server/telemetry.ts';
import type { RequestHandler } from './$types';

/**
 * Anyone can POST here — that's unavoidable for browser error reporting — so
 * the limits below are what stop it being a way to fill the volume or spam the
 * Discord channel. They're per-process, so a restart (a deploy, a crash) hands
 * out a fresh allowance — acceptable, since restarts are rare and one allowance
 * is small.
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

/**
 * Only the message is required. A stack or route of the wrong type is dropped
 * rather than refused: the report is still worth having without it, and the
 * browser that sent it has no way to try again.
 */
const reportSchema = z.object({
	message: z.string().trim().min(1),
	stack: z.string().nullable().catch(null),
	route: z
		.string()
		.transform((route) => route.slice(0, MAX_ROUTE))
		.nullable()
		.catch(null)
});

export const POST: RequestHandler = async (event) => {
	const ip = clientIp(event);
	if (!limiter.allow(ip, Date.now())) throw error(429, 'Too many reports');

	const raw = await event.request.text();
	if (raw.length > MAX_BODY) throw error(413, 'Report too large');

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw error(400, 'Malformed report');
	}

	// Everything this handler rejects has to be rejected on purpose. Valid JSON
	// need not be an object — `null` parses — and reading a property off it would
	// throw, which SvelteKit would hand to `handleError` as a fault of the
	// server's own: an anonymous POST recorded and alerted on as trusted.
	const report = reportSchema.safeParse(parsed);
	if (!report.success) throw error(400, 'Report needs a message');

	reportError({ source: 'client', ...report.data });

	return Response.json({ status: 'recorded' }, { status: 202 });
};
