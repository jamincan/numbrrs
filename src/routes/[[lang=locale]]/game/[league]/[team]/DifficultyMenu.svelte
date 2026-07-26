<script lang="ts">
	import { getI18n } from '$lib/i18n/state.svelte';
	import type { Messages } from '$lib/i18n/messages';

	const i18n = getI18n();

	type Option = { key: keyof Messages['game']['difficulty']; value: number };
	type Props = {
		options: readonly Option[];
		value: number;
		onselect: (value: number) => void;
	};

	const { options, value, onselect }: Props = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
</script>

<!-- Close on any click outside the menu, or on Escape. -->
<svelte:window
	onclick={(e) => {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}}
	onkeydown={(e) => {
		if (e.key === 'Escape') open = false;
	}}
/>

<div class="relative" bind:this={root}>
	<button
		onclick={() => (open = !open)}
		aria-label={i18n.m.game.difficultyLabel}
		aria-haspopup="menu"
		aria-expanded={open}
		class="flex items-center rounded-md border border-white/10 bg-white/5 p-1 text-gray-400 transition-colors hover:text-white"
		class:text-white={open}
	>
		<!-- Lucide "gauge" (ISC), inlined like the GitHub mark in the nav. -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="m12 14 4-4" />
			<path d="M3.34 19a10 10 0 1 1 17.32 0" />
		</svg>
	</button>

	{#if open}
		<div
			role="menu"
			class="absolute right-0 z-50 mt-2 w-36 rounded-lg border border-white/10 bg-gray-900 py-1 shadow-2xl"
		>
			{#each options as opt (opt.key)}
				{@const active = value === opt.value}
				<button
					role="menuitemradio"
					aria-checked={active}
					onclick={() => {
						onselect(opt.value);
						open = false;
					}}
					class="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-white/10 {active
						? 'text-white'
						: 'text-gray-400'}"
				>
					{i18n.m.game.difficulty[opt.key]}
					{#if active}
						<!-- Lucide "check" -->
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="14"
							height="14"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
