<script lang="ts">
	import { LOCALES } from '$lib/i18n';
	import { getI18n } from '$lib/i18n/state.svelte';

	const i18n = getI18n();
</script>

<div
	class="flex items-center rounded-md border border-white/10 bg-white/5 p-0.5"
	role="group"
	aria-label={i18n.m.language}
>
	{#each LOCALES as locale (locale)}
		<button
			type="button"
			onclick={() => i18n.setLocale(locale)}
			aria-pressed={i18n.locale === locale}
			class="font-condensed rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase transition-colors {i18n.locale ===
			locale
				? 'bg-white/15 text-white'
				: 'text-gray-500 hover:text-gray-300'}"
		>
			{locale}
		</button>
	{/each}
</div>
