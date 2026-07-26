<script lang="ts">
	import { resolve } from '$app/paths';
	import { getI18n } from '$lib/i18n/state.svelte';
	import type { Snippet } from 'svelte';

	const i18n = getI18n();

	type Props = {
		name: string;
		color?: string;
		/** Right-hand side of the header; a spacer keeps the title centred when absent. */
		children?: Snippet;
	};

	let { name, color, children }: Props = $props();
</script>

<header class="flex items-center justify-between px-6 py-4">
	<a
		href={resolve('/[[lang=locale]]', { lang: i18n.lang })}
		class="text-sm text-gray-400 hover:text-white">&larr; {i18n.m.game.back}</a
	>
	<h1 class="text-xl font-bold" style="color: {color ?? '#fff'};">
		{name}
	</h1>
	{#if children}
		{@render children()}
	{:else}
		<div class="w-12"></div>
	{/if}
</header>
