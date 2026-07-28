<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getI18n } from '$lib/i18n/state.svelte';

	// At the root rather than under [[lang=locale]] so it also catches URLs that
	// match no route at all — the most likely way someone arrives here, from a
	// stale shared link. See the fallback in +layout.svelte for what that costs.
	const i18n = getI18n();

	const notFound = $derived(page.status === 404);
	const title = $derived(notFound ? i18n.m.error.notFoundTitle : i18n.m.error.genericTitle);
	const body = $derived(notFound ? i18n.m.error.notFoundBody : i18n.m.error.genericBody);

	// SvelteKit's own message for an unhandled error is the generic "Internal
	// Error", which says less than our own copy does. Anything thrown with
	// error() carries a message worth showing — "League not found" tells someone
	// what they got wrong. 500s are the ones to keep quiet about.
	const detail = $derived(page.status < 500 ? page.error?.message : undefined);
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
			{i18n.m.error.reference}: {page.error.id}
		</p>
	{/if}
</main>
