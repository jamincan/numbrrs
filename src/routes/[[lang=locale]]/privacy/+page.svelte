<script lang="ts">
	import { getI18n } from '$lib/i18n/state.svelte';

	const i18n = getI18n();

	// The date the wording last changed, not a build timestamp — a policy that
	// claims to have been updated on every deploy tells a reader nothing.
	const UPDATED = '2026-07-27';
	const updated = $derived(
		new Intl.DateTimeFormat(i18n.locale, { dateStyle: 'long' }).format(
			new Date(`${UPDATED}T12:00:00Z`)
		)
	);

	const sections = $derived([
		{ title: i18n.m.privacy.hashTitle, body: i18n.m.privacy.hashBody },
		{ title: i18n.m.privacy.cookiesTitle, body: i18n.m.privacy.cookiesBody },
		{ title: i18n.m.privacy.errorsTitle, body: i18n.m.privacy.errorsBody },
		{ title: i18n.m.privacy.retentionTitle, body: i18n.m.privacy.retentionBody },
		{ title: i18n.m.privacy.sharingTitle, body: i18n.m.privacy.sharingBody },
		{ title: i18n.m.privacy.contactTitle, body: i18n.m.privacy.contactBody }
	]);
</script>

<svelte:head>
	<title>{i18n.m.privacy.title} · Numbrrs</title>
	<meta name="description" content={i18n.m.privacy.description} />
	<meta property="og:title" content="{i18n.m.privacy.title} · Numbrrs" />
	<meta property="og:description" content={i18n.m.privacy.description} />
</svelte:head>

<main class="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
	<h1 class="font-condensed mb-6 text-4xl font-black text-white">{i18n.m.privacy.title}</h1>

	<p class="mb-10 text-lg text-gray-300">{i18n.m.privacy.summary}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">
		{i18n.m.privacy.collectedTitle}
	</h2>
	<ul class="mb-10 list-disc space-y-1 pl-5 text-gray-400">
		{#each i18n.m.privacy.collected as item (item)}
			<li>{item}</li>
		{/each}
	</ul>

	{#each sections as section (section.title)}
		<h2 class="font-condensed mb-3 text-xl font-bold text-white">{section.title}</h2>
		<p class="mb-10 text-gray-400">
			{section.body}
			{#if section.title === i18n.m.privacy.contactTitle}
				<a
					href="https://github.com/jamincan/numbrrs/issues"
					target="_blank"
					rel="noopener noreferrer"
					class="text-white underline underline-offset-2 hover:text-gray-300"
				>
					github.com/jamincan/numbrrs
				</a>
			{/if}
		</p>
	{/each}

	<p class="text-sm text-gray-600">{i18n.m.privacy.updated(updated)}</p>
</main>
