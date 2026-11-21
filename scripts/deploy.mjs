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
import https from 'node:https';

const BRANCH = 'master';
const WORKFLOW = 'ci.yml';
const SITE = 'https://numbrrs.app';
// Fly's own hostname, which reaches the app without passing through Cloudflare.
const ORIGIN = 'https://numbrrs.fly.dev';

/**
 * @typedef {object} SmokeCheck
 * @property {string} url
 * @property {number} status
 * @property {string} [location] the Location header the answer must carry
 * @property {string} [host] sent as the Host header in place of the URL's own
 */

/** @type {SmokeCheck[]} */
const SMOKE_CHECKS = [
	{ url: `${SITE}/api/health`, status: 200 },
	{ url: `${SITE}/`, status: 200 },
	{ url: `${SITE}/game/nhl/TOR`, status: 200 },
	// The one thing Fly's hostname still answers itself: its own health check
	// and the uptime probe ask there.
	{ url: `${ORIGIN}/api/health`, status: 200 },
	// Everything else on it is sent to the site's hostname, where Cloudflare
	// Access guards /admin. A 200 here means ADMIN_DIRECT has been left on.
	{ url: `${ORIGIN}/admin`, status: 308, location: `${SITE}/admin` },
	// What that leaves is a connection made straight to Fly that names the
	// site's host, which Access never saw. Around Cloudflare there is only the
	// app's own check, and it has to be refusing.
	{ url: `${ORIGIN}/admin`, host: new URL(SITE).host, status: 403 }
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
 * What a check expects, as one line.
 * @param {SmokeCheck} check
 */
function describeCheck(check) {
	return [
		`${check.status}  ${check.url}`,
		check.host ? ` (Host: ${check.host})` : '',
		check.location ? ` -> ${check.location}` : ''
	].join('');
}

/**
 * One request, answered as it came. `https.request` rather than `fetch`,
 * because it never follows a redirect — which is an answer in its own right,
 * not something to follow to a 200 somewhere else — and because it will send a
 * Host header that differs from the URL, which `fetch` refuses to.
 * @param {SmokeCheck} check
 * @returns {Promise<string>} what came back, in the form `describeCheck` gives what should
 */
function answerTo(check) {
	const { hostname } = new URL(check.url);
	return new Promise((resolve) => {
		const request = https.request(
			check.url,
			{
				headers: {
					// Without this the home page may answer with a redirect to /fr.
					'accept-language': 'en',
					'user-agent': 'numbrrs-deploy-check',
					...(check.host ? { host: check.host } : {})
				},
				// Node would otherwise take the TLS server name from the Host header.
				// The connection is to the URL's host and has to verify as that.
				servername: hostname,
				// A connection of its own for each question. A kept-alive one that the
				// far end has since closed would read as a failed check.
				agent: false,
				timeout: SMOKE_REQUEST_TIMEOUT_MS
			},
			(response) => {
				response.resume();
				const { location } = response.headers;
				resolve(
					describeCheck({
						...check,
						status: response.statusCode ?? 0,
						// Only compared when the check names one.
						location: check.location === undefined ? undefined : (location ?? 'no Location')
					})
				);
			}
		);
		request.on('timeout', () => request.destroy(new Error('timed out')));
		request.on('error', (err) => resolve(err.message));
		request.end();
	});
}

/**
 * Ask each URL until it gives the answer it should, or time runs out.
 * @returns {Promise<{ check: SmokeCheck, got: string }[]>} the checks still failing
 */
async function smokeCheck() {
	const deadline = Date.now() + SMOKE_DEADLINE_MS;
	let pending = SMOKE_CHECKS;

	for (;;) {
		const results = await Promise.all(
			pending.map(async (check) => ({ check, got: await answerTo(check) }))
		);
		const failing = results.filter(({ check, got }) => got !== describeCheck(check));
		for (const { check, got } of results) {
			if (got === describeCheck(check)) console.log(`  ok    ${got}`);
		}
		if (failing.length === 0 || Date.now() + SMOKE_INTERVAL_MS > deadline) return failing;
		pending = failing.map(({ check }) => check);
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
	for (const check of SMOKE_CHECKS) console.log(`  ${describeCheck(check)}`);
	process.exit(0);
}

if (run('flyctl', deployArgs) !== 0) refuse('flyctl deploy failed; nothing was checked after it');

console.log('\nChecking the deployed app...');
const failing = await smokeCheck();
if (failing.length > 0) {
	for (const { check, got } of failing) {
		console.error(`  FAIL  wanted ${describeCheck(check)}\n        got    ${got}`);
	}
	refuse(
		'the deploy went out, but the checks above are still failing. Look at `flyctl status` and `flyctl logs`; `flyctl releases` lists the earlier ones to go back to.'
	);
}

console.log(
	`\nDeployed ${sha.slice(0, 7)}. Remember to purge the Cloudflare cache: until then the edge may keep serving pages from the previous build.`
);
