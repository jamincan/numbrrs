<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getI18n } from '#lib/i18n/state.svelte.ts';

	// At the root rather than under [[lang=locale]] so it also catches URLs that
	// match no route at all — the most likely way someone arrives here, from a
	// stale shared link. See the fallback in +layout.svelte for what that costs.
	const i18n = getI18n();

	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? i18n.m.error.notFoundTitle : i18n.m.error.genericTitle);
	const body = $derived(notFound ? i18n.m.error.notFoundBody : i18n.m.error.genericBody);

	// What SvelteKit says about errors of its own. They are the HTTP status text,
	// in English whatever the page's language, and say nothing the localized
	// title above them hasn't: "Not Found" under "Page introuvable" is noise.
	// There is no flag on page.error to tell these from the app's own messages,
	// so they are matched by text.
	const FRAMEWORK_MESSAGES = new Set([
		'Bad Request',
		'Malformed URI',
		'Not Found',
		'Method Not Allowed',
		'Payload Too Large',
		'Unsupported Media Type',
		'Internal Error'
	]);

	// The two messages the game page's load throws (game/[league]/[team]/
	// +page.server.ts). An error crosses to the page as its text and nothing
	// else, so these are matched by text as well, and shown from the catalogue
	// in the page's language.
	const LOCALIZED_MESSAGES = new Map<string, 'leagueNotFound' | 'teamNotFound'>([
		['League not found', 'leagueNotFound'],
		['Team not found', 'teamNotFound']
	]);

	// Anything thrown with error() carries a message worth showing — "League not
	// found" tells someone what they got wrong. 500s are the ones to keep quiet
	// about. A message the catalogue doesn't know is shown as it was written.
	const detail = $derived.by(() => {
		const message = page.status < 500 ? page.error?.message : undefined;
		if (!message || FRAMEWORK_MESSAGES.has(message)) return undefined;
		const key = LOCALIZED_MESSAGES.get(message);
		return key ? i18n.m.error[key] : message;
	});

	// French sets a no-break space before a colon. Built from its code point for
	// the reasons given in i18n/fr.ts.
	const colon = $derived(i18n.locale === 'fr' ? `${String.fromCharCode(0xa0)}: ` : ': ');
</script>

<svelte:head>
	<title>{title} · Numbrrs</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<main class="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
	<p class="font-condensed text-7xl font-black text-gray-700">{page.status}</p>

	<h1 class="font-condensed text-3xl font-bold text-white">{title}</h1>
	<p class="max-w-prose text-gray-400">{body}</p>

	{#if detail && detail !== title}
		<p class="text-sm text-gray-500">{detail}</p>
	{/if}

	<a
		href={resolve('/[[lang=locale]]', { lang: i18n.lang })}
		class="mt-2 rounded bg-white px-4 py-2 font-semibold text-gray-950 transition-colors hover:bg-gray-200"
	>
		{i18n.m.error.home}
	</a>

	{#if page.error?.id}
		<!-- The fingerprint of the recorded error. Quoting it back points at one
		     row in /admin, which is the whole reason it's on screen. -->
		<p class="mt-4 font-mono text-xs text-gray-600">
			{i18n.m.error.reference}{colon}{page.error.id}
		</p>
	{/if}
</main>
