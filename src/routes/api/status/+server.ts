import { NO_STORE } from '#lib/server/request-policy.ts';
import { currentStatus } from './report.ts';
import type { RequestHandler } from './$types';

/**
 * The machine's own account of itself, for the uptime probe: see report.ts for
 * what is in it and what is deliberately left out.
 *
 * Always a 200. The body's `ok` and each check's carry the verdict, so the
 * probe can tell "the machine answered and says its disk check failed" from
 * "nothing answered", which a 503 would blur — Fly's proxy sends its own 5xx
 * when the machine is not there. Nothing but that probe reads this; Fly's
 * health check stays on `/api/health`, which touches less and so has fewer
 * ways to take the machine out of rotation.
 */
export const GET: RequestHandler = () =>
	Response.json(currentStatus(), { headers: { 'cache-control': NO_STORE } });
