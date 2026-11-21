import { reportError } from '#lib/server/alerts.ts';

/**
 * How long the alert gets to leave before the process is ended. The row is
 * already written by then — `reportError` does that synchronously — so this
 * only buys the webhook POST a chance; it is not worth staying up for in a
 * state nobody can vouch for.
 */
const FLUSH_MS = 1500;

/** The parts of `process` this needs, so a test can stand in something that doesn't exit. */
export interface GuardedProcess {
	on(
		event: 'uncaughtException' | 'unhandledRejection',
		listener: (reason: unknown) => void
	): unknown;
	exit(code: number): unknown;
	exitCode?: typeof process.exitCode;
}

let installed = false;

/**
 * Record whatever is about to kill the process, then let it die.
 *
 * Node already exits on an uncaught exception or an unhandled rejection, and it
 * should: nothing can say what state the process is left in. But it exits
 * having written only to stderr, which Fly doesn't keep, so the restart is the
 * only trace — and a restart doesn't say what caused it. Attaching a listener
 * takes over Node's default, so the exit has to be done here.
 *
 * Safe to call more than once; the listeners are attached the first time only.
 */
export function installProcessGuards(target: GuardedProcess = process): void {
	if (installed) return;
	installed = true;

	let exiting = false;

	const crash = (kind: 'uncaughtException' | 'unhandledRejection', reason: unknown) => {
		if (!exiting) {
			exiting = true;
			// Set first, in case the event loop empties before the timer fires and
			// the process ends by itself — it must not report success.
			target.exitCode = 1;
			// Armed before reporting so that nothing in the report can prevent it,
			// and unref'd so the wait never holds open a process with nothing left
			// to do.
			setTimeout(() => target.exit(1), FLUSH_MS).unref();
		}

		// A second fault during the wait is still reported — it folds into its own
		// row — but doesn't extend the deadline.
		try {
			const label = kind === 'uncaughtException' ? 'Uncaught exception' : 'Unhandled rejection';
			const detail = reason instanceof Error ? reason.message : String(reason);
			reportError({
				source: 'server',
				message: `${label}: ${detail}`,
				stack: reason instanceof Error ? reason.stack : null,
				route: `process:${kind}`,
				error: reason
			});
		} catch (err) {
			// reportError doesn't throw, but a handler for fatal errors is the wrong
			// place to rely on that.
			console.error(`[process] ${kind}, and reporting it failed:`, reason, err);
		}
	};

	target.on('uncaughtException', (error) => crash('uncaughtException', error));
	target.on('unhandledRejection', (reason) => crash('unhandledRejection', reason));
}
