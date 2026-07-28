import type { ZodType } from 'zod';

/**
 * Raised when an external feed stops matching the shape we parse it into.
 *
 * Deliberately its own type rather than a plain Error. A timeout is worth
 * retrying and a schema change never is — the next request returns exactly the
 * same thing — and the sync layer's retry decision keys off that difference. It
 * also means "the NHL renamed a field" shows up in the logs as its own class of
 * failure instead of blending into the network blips.
 */
export class FeedSchemaError extends Error {
	constructor(context: string, detail: string) {
		super(`${context} schema mismatch — ${detail}`);
		this.name = 'FeedSchemaError';
	}
}

/** Past a handful, listing issues stops being a diagnosis and starts being noise. */
const MAX_REPORTED_ISSUES = 3;

/**
 * Validate a payload from a feed we don't control, naming the field that moved.
 *
 * The point is the log line. `roster.forwards.0.firstName: invalid type` tells
 * you the NHL flattened a name object and roughly how long the fix takes;
 * "sync failed" tells you nothing and costs an afternoon.
 */
export function parseFeed<T>(schema: ZodType<T>, value: unknown, context: string): T {
	const result = schema.safeParse(value);
	if (result.success) return result.data;

	const { issues } = result.error;
	const detail = issues
		.slice(0, MAX_REPORTED_ISSUES)
		.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
		.join('; ');
	const rest = issues.length - MAX_REPORTED_ISSUES;

	throw new FeedSchemaError(context, rest > 0 ? `${detail} (+${rest} more)` : detail);
}
