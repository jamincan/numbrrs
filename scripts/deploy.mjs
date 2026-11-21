/**
 * Deploys master to Fly: `pnpm run deploy` (the `run` matters, because
 * `pnpm deploy` is an unrelated pnpm built-in), or with `--dry-run` to do every
 * check and stop short of deploying.
 *
 * `flyctl deploy` on its own ships whatever is in the working directory, tested
 * or not, committed or not. This refuses unless the directory is exactly the
 * commit at the tip of origin/master and CI passed for that commit, then checks
 * that what came up is actually serving.
 *
 * Plain Node with no dependencies, and no shell in between: git, gh and flyctl
 * are run directly, so it behaves the same from PowerShell and Git Bash.
 */
import { spawnSync } from 'node:child_process';

const BRANCH = 'master';
const WORKFLOW = 'ci.yml';
const SITE = 'https://numbrrs.app';
// Fly's own hostname, which reaches the app without passing through Cloudflare.
const ORIGIN = 'https://numbrrs.fly.dev';

const SMOKE_CHECKS = [
	{ url: `${SITE}/api/health`, status: 200 },
	{ url: `${SITE}/`, status: 200 },
	{ url: `${SITE}/game/nhl/TOR`, status: 200 },
	// Cloudflare Access guards /admin on the site's own hostname. Around
	// Cloudflare there is only the app's check, and it has to be refusing.
	{ url: `${ORIGIN}/admin`, status: 403 }
];
/** A new machine takes a while to pass its health check and take traffic. */
const SMOKE_DEADLINE_MS = 60_000;
const SMOKE_INTERVAL_MS = 5_000;
const SMOKE_REQUEST_TIMEOUT_MS = 10_000;

/**
 * @param {string} message
 * @returns {never}
 */
function refuse(message) {
	console.error(`\ndeploy: ${message}`);
	process.exit(1);
}

/**
 * Run a command and return what it printed. Any failure ends the deploy: every
 * call here is a precondition, and a check that could not be made has not passed.
 * @param {string} command
 * @param {string[]} args
 */
function read(command, args) {
	const result = spawnSync(command, args, { encoding: 'utf8' });
	if (result.error) refuse(`could not run ${command}: ${result.error.message}`);
	if (result.status !== 0) {
		refuse(`\`${command} ${args.join(' ')}\` failed:\n${(result.stderr || result.stdout).trim()}`);
	}
	// Only the end: `git status --porcelain` lines start with a significant space.
	return result.stdout.trimEnd();
}

/**
 * Run a command with its output going straight to the terminal.
 * @param {string} command
 * @param {string[]} args
 * @returns {number} its exit code
 */
function run(command, args) {
	const result = spawnSync(command, args, { stdio: 'inherit' });
	if (result.error) refuse(`could not run ${command}: ${result.error.message}`);
	return result.status ?? 1;
}

/**
 * The CI run for a commit on master, newest first if it was run more than once.
 * Limited to push runs on the branch: a pull request's run can carry the same
 * commit hash while having tested it merged into a different base.
 * @param {string} sha
 * @returns {{ databaseId: number, status: string, conclusion: string | null } | undefined}
 */
function ciRun(sha) {
	const out = read('gh', [
		'run',
		'list',
		'--workflow',
		WORKFLOW,
		'--commit',
		sha,
		'--branch',
		BRANCH,
		'--event',
		'push',
		'--json',
		'databaseId,status,conclusion'
	]);
	return JSON.parse(out)[0];
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} url
 * @returns {Promise<number | string>} the status, or why there wasn't one
 */
async function statusOf(url) {
	try {
		const response = await fetch(url, {
			// A redirect is an answer in its own right, not something to follow to
			// a 200 somewhere else.
			redirect: 'manual',
			// Without this the home page may answer with a redirect to /fr.
			headers: { 'accept-language': 'en', 'user-agent': 'numbrrs-deploy-check' },
			signal: AbortSignal.timeout(SMOKE_REQUEST_TIMEOUT_MS)
		});
		await response.body?.cancel();
		return response.status;
	} catch (err) {
		return err instanceof Error ? err.message : String(err);
	}
}

/**
 * Ask each URL until it gives the status it should, or time runs out.
 * @returns {Promise<{ url: string, status: number, got: number | string }[]>} the checks still failing
 */
async function smokeCheck() {
	const deadline = Date.now() + SMOKE_DEADLINE_MS;
	let pending = SMOKE_CHECKS;

	for (;;) {
		const results = await Promise.all(
			pending.map(async (check) => ({ ...check, got: await statusOf(check.url) }))
		);
		for (const { url, status, got } of results) {
			if (got === status) console.log(`  ok    ${status}  ${url}`);
		}
		const failing = results.filter(({ status, got }) => got !== status);
		if (failing.length === 0 || Date.now() + SMOKE_INTERVAL_MS > deadline) return failing;
		pending = failing.map(({ url, status }) => ({ url, status }));
		await sleep(SMOKE_INTERVAL_MS);
	}
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const unknown = args.filter((arg) => arg !== '--dry-run');
if (unknown.length > 0)
	refuse(`unknown argument ${unknown.join(' ')}; the only option is --dry-run`);

// Untracked files count as well: the image is built from the directory, not
// from the commit.
const dirty = read('git', ['status', '--porcelain']);
if (dirty) refuse(`the working tree has changes that are not committed:\n${dirty}`);

const branch = read('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch !== BRANCH) refuse(`on ${branch}; deploys go out from ${BRANCH}`);

read('git', ['fetch', '--quiet', 'origin', BRANCH]);
const sha = read('git', ['rev-parse', 'HEAD']);
const remoteSha = read('git', ['rev-parse', `origin/${BRANCH}`]);
if (sha !== remoteSha) {
	refuse(
		`HEAD (${sha.slice(0, 7)}) is not origin/${BRANCH} (${remoteSha.slice(0, 7)}); push or pull first, so that what is deployed is what CI tested`
	);
}

let ci = ciRun(sha);
if (!ci) {
	refuse(
		`no ${WORKFLOW} run found for ${sha.slice(0, 7)}; if it was only just pushed, give GitHub a moment and try again`
	);
}
if (ci.status !== 'completed') {
	console.log(`CI run ${ci.databaseId} is ${ci.status}; waiting for it...`);
	// The exit code is not the verdict here; the run is read back below.
	run('gh', ['run', 'watch', String(ci.databaseId), '--exit-status']);
	ci = ciRun(sha);
}
if (!ci || ci.status !== 'completed' || ci.conclusion !== 'success') {
	refuse(
		`CI did not pass for ${sha.slice(0, 7)} (${ci ? `run ${ci.databaseId}: ${ci.conclusion ?? ci.status}` : 'run not found'}); see \`gh run view ${ci?.databaseId ?? ''} --log-failed\``
	);
}
console.log(`CI run ${ci.databaseId} passed for ${sha.slice(0, 7)}.`);

// Labelled with the commit, so the image a release runs says what it was built from.
const deployArgs = [
	'deploy',
	'--image-label',
	`git-${read('git', ['rev-parse', '--short', 'HEAD'])}`
];

if (dryRun) {
	console.log(
		`\nDry run. Every check passed; this would now run:\n  flyctl ${deployArgs.join(' ')}`
	);
	console.log('and then expect, within a minute:');
	for (const check of SMOKE_CHECKS) console.log(`  ${check.status}  ${check.url}`);
	process.exit(0);
}

if (run('flyctl', deployArgs) !== 0) refuse('flyctl deploy failed; nothing was checked after it');

console.log('\nChecking the deployed app...');
const failing = await smokeCheck();
if (failing.length > 0) {
	for (const check of failing) {
		console.error(`  FAIL  wanted ${check.status}, got ${check.got}  ${check.url}`);
	}
	refuse(
		'the deploy went out, but the checks above are still failing. Look at `flyctl status` and `flyctl logs`; `flyctl releases` lists the earlier ones to go back to.'
	);
}

console.log(
	`\nDeployed ${sha.slice(0, 7)}. Remember to purge the Cloudflare cache: until then the edge may keep serving pages from the previous build.`
);
