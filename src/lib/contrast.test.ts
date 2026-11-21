import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../scripts/contrast-check.mjs', import.meta.url));

/**
 * Runs the checker as the command it is, in a process of its own: it reads
 * team-colors.ts and the components off disk, the way it does from a terminal,
 * and what is asserted is what a terminal would see. Its output is the whole
 * report, so a failure here names the pair and the teams.
 *
 * It needs no browser and takes well under a second, which is what lets it sit
 * in the unit suite: a new team, a retuned colour or a restyled card is
 * measured on the next run.
 */
function run(): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		execFile(process.execPath, [SCRIPT], (error, stdout, stderr) => {
			const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
			resolve({ code, output: stdout + stderr });
		});
	});
}

test('every team colour and grey the site puts text on meets WCAG AA contrast', async () => {
	const { code, output } = await run();
	expect(output).toContain('No pair is under its threshold.');
	expect(code).toBe(0);
});
