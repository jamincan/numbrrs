import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The guard's job is to call reportError and exit; what reportError then does
// is alerts.test.ts's business. Mocked so nothing here can reach the database
// or a webhook.
const reportError = vi.hoisted(() => vi.fn());
vi.mock('./alerts', () => ({ reportError }));

/**
 * Stands in for `process`: the real one would have the guard's listeners left
 * attached to the test runner, and its exit would end the run.
 */
function fakeProcess() {
	return Object.assign(new EventEmitter(), {
		exit: vi.fn<(code: number) => void>(),
		exitCode: undefined as number | undefined
	});
}

/** Fresh module each time: "already installed" is module state. */
async function install(target: ReturnType<typeof fakeProcess>): Promise<void> {
	vi.resetModules();
	const { installProcessGuards } = await import('./process-guards');
	installProcessGuards(target);
	installProcessGuards(target);
}

beforeEach(() => {
	vi.useFakeTimers();
	reportError.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe('installProcessGuards', () => {
	it('attaches one listener per event however often it is called', async () => {
		const target = fakeProcess();
		await install(target);

		expect(target.listenerCount('uncaughtException')).toBe(1);
		expect(target.listenerCount('unhandledRejection')).toBe(1);
	});

	it('records an uncaught exception, then exits non-zero after a short wait', async () => {
		const target = fakeProcess();
		await install(target);
		const error = new Error('boom', { cause: new Error('root') });

		target.emit('uncaughtException', error);

		expect(reportError).toHaveBeenCalledExactlyOnceWith({
			source: 'server',
			message: 'Uncaught exception: boom',
			stack: error.stack,
			route: 'process:uncaughtException',
			error
		});
		// The row is written; the exit waits for the webhook POST, but not for long.
		expect(target.exitCode).toBe(1);
		expect(target.exit).not.toHaveBeenCalled();

		vi.advanceTimersByTime(2000);
		expect(target.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('records an unhandled rejection, whatever was rejected with', async () => {
		const target = fakeProcess();
		await install(target);

		target.emit('unhandledRejection', 'just a string');

		expect(reportError).toHaveBeenCalledExactlyOnceWith({
			source: 'server',
			message: 'Unhandled rejection: just a string',
			stack: null,
			route: 'process:unhandledRejection',
			error: 'just a string'
		});
		vi.advanceTimersByTime(2000);
		expect(target.exit).toHaveBeenCalledExactlyOnceWith(1);
	});

	it('reports a second fault during the wait without a second exit', async () => {
		const target = fakeProcess();
		await install(target);

		target.emit('uncaughtException', new Error('first'));
		vi.advanceTimersByTime(500);
		target.emit('unhandledRejection', new Error('second'));
		vi.advanceTimersByTime(5000);

		expect(reportError).toHaveBeenCalledTimes(2);
		expect(target.exit).toHaveBeenCalledTimes(1);
	});

	it('still exits when reporting itself throws', async () => {
		const target = fakeProcess();
		await install(target);
		reportError.mockImplementation(() => {
			throw new Error('reporter broke');
		});

		expect(() => target.emit('uncaughtException', new Error('boom'))).not.toThrow();

		vi.advanceTimersByTime(2000);
		expect(target.exit).toHaveBeenCalledExactlyOnceWith(1);
	});
});
