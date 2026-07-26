<script lang="ts">
	import { page } from '$app/state';
	import { LOCALES, localizePath } from '$lib/i18n';
	import { getI18n } from '$lib/i18n/state.svelte';

	const i18n = getI18n();
</script>

<!-- Links, not buttons: each language lives at its own URL, so switching is a
     navigation. The cookie written on click only stops the Accept-Language
     redirect from overriding an explicit choice on the next visit. -->
<div
	class="flex items-center rounded-md border border-white/10 bg-white/5 p-0.5"
	role="group"
	aria-label={i18n.m.language}
>
	{#each LOCALES as locale (locale)}
		<a
			href={localizePath(page.url.pathname, locale) + page.url.search}
			onclick={() => i18n.remember(locale)}
			aria-current={i18n.locale === locale ? 'true' : undefined}
			class="font-condensed rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase transition-colors {i18n.locale ===
			locale
				? 'bg-white/15 text-white'
				: 'text-gray-500 hover:text-gray-300'}"
		>
			{locale}
		</a>
	{/each}
</div>
