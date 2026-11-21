import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import Database from 'better-sqlite3';
import { isHttpError } from '@sveltejs/kit';
import { getDb, initDb } from '#lib/server/db/index.ts';
import { errors } from '#lib/server/db/schema.ts';

// A blank webhook, set here rather than trusted from the environment: the real
// reportError runs below, and with a URL it would post.
vi.mock('$app/env/private', () => ({
	ALERT_WEBHOOK_URL: '',
	ADMIN_TOKEN: undefined,
	ADMIN_DIRECT: false,
	EDGE_TOKEN: undefined,
	DATABASE_URL: ':memory:'
}));

// How an address is derived from headers is client-ip.ts's concern and has its
// own tests; here each request just states who it is from.
vi.mock('#lib/server/client-ip.ts', () => ({
	clientIp: (event: { request: Request }) => event.request.headers.get('x-test-ip') ?? 'unknown'
}));

const { POST } = await import('./+server');

let fetchMock: Mock;
let nextAddress = 0;

/** A new address per call, so the rate limit only applies where a test asks for it. */
function freshIp(): string {
	nextAddress += 1;
	return `198.51.100.${nextAddress}`;
}

/**
 * The status the endpoint answers with. `error()` throws rather than returns,
 * so a deliberate rejection is unwrapped here — and anything else thrown
 * propagates and fails the test, which is the point: an accidental throw is
 * what SvelteKit would record as a server error.
 */
async function send(body: string, ip = freshIp()): Promise<number> {
	const request = new Request('https://numbrrs.app/api/client-error', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-test-ip': ip },
		body
	});
	try {
		const response = await POST({ request } as unknown as Parameters<typeof POST>[0]);
		return response.status;
	} catch (err) {
		if (isHttpError(err)) return err.status;
		throw err;
	}
}

function recorded() {
	return getDb().select().from(errors).all();
}

beforeEach(() => {
	initDb(new Database(':memory:'));
	fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
	vi.stubGlobal('fetch', fetchMock);
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('POST /api/client-error', () => {
	it('records a report as a client error and answers 202', async () => {
		const status = await send(
			JSON.stringify({ message: '  x is not a function  ', stack: 'at y', route: '/game' })
		);

		expect(status).toBe(202);
		expect(recorded()).toMatchObject([
			{ source: 'client', message: 'x is not a function', stack: 'at y', route: '/game', count: 1 }
		]);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('truncates an overlong route rather than refusing the report', async () => {
		const status = await send(JSON.stringify({ message: 'boom', route: `/${'a'.repeat(500)}` }));

		expect(status).toBe(202);
		expect(recorded()[0]?.route).toHaveLength(200);
	});

	it('drops a stack or route of the wrong type and keeps the report', async () => {
		const status = await send(JSON.stringify({ message: 'boom', stack: 42, route: { id: '/' } }));

		expect(status).toBe(202);
		expect(recorded()).toMatchObject([{ message: 'boom', stack: null, route: null }]);
	});

	it.each(['null', '[]', '"a string"', '42', 'true'])(
		'answers 400 to valid JSON that is not a report: %s',
		async (body) => {
			expect(await send(body)).toBe(400);
			// In particular, not one recorded against the server itself.
			expect(recorded()).toEqual([]);
		}
	);

	it.each([
		['no message', {}],
		['a blank message', { message: '   ' }],
		['a message that is not text', { message: { toString: 'x' } }]
	])('answers 400 to %s', async (_name, body) => {
		expect(await send(JSON.stringify(body))).toBe(400);
		expect(recorded()).toEqual([]);
	});

	it('answers 400 to a body that is not JSON', async () => {
		expect(await send('{"message": ')).toBe(400);
		expect(recorded()).toEqual([]);
	});

	it('answers 413 to a body over 8kb', async () => {
		expect(await send(JSON.stringify({ message: 'x'.repeat(8 * 1024) }))).toBe(413);
		expect(recorded()).toEqual([]);
	});

	it('answers 429 after five reports from one address, and only to that address', async () => {
		const ip = freshIp();
		const body = JSON.stringify({ message: 'boom', route: '/' });

		for (let i = 0; i < 5; i++) expect(await send(body, ip)).toBe(202);
		expect(await send(body, ip)).toBe(429);
		expect(await send(body)).toBe(202);

		expect(recorded()).toMatchObject([{ count: 6 }]);
	});
});
