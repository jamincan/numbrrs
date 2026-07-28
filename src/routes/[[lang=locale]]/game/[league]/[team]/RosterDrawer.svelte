<script lang="ts">
	import type { DrawerLayout } from '$lib/drawer-layout.svelte';
	import type { GameState } from '$lib/game-state.svelte';
	import { getI18n } from '$lib/i18n/state.svelte';
	import type { Gender } from '$lib/i18n';
	import type { Player } from '$lib/types';

	const i18n = getI18n();

	const {
		roster,
		game,
		gender,
		layout,
		primaryColor
	}: {
		roster: Player[];
		game: GameState;
		gender: Gender;
		layout: DrawerLayout;
		primaryColor?: string;
	} = $props();

	const forwards = $derived(
		roster.filter((player) => ['L', 'C', 'R', 'F'].includes(player.positionCode))
	);
	const defensemen = $derived(roster.filter((player) => player.positionCode === 'D'));
	const goalies = $derived(roster.filter((player) => player.positionCode === 'G'));
	const other = $derived(
		roster.filter((player) => !['L', 'C', 'R', 'F', 'D', 'G'].includes(player.positionCode))
	);
</script>

{#snippet playerGrid(group: Player[])}
	<!-- Columns follow the container, not the viewport: this grid renders at
	     widths from a narrow landscape-phone panel to a full-width bottom
	     drawer on a tablet. -->
	<div class="grid grid-cols-1 gap-1.5 @min-[20rem]:grid-cols-2 @min-[30rem]:grid-cols-3">
		{#each group as player (player.id)}
			{@const identified = game.identified.includes(player.id)}
			{@const selectable = game.current?.optionIds.includes(player.id) ?? false}
			{#if identified}
				<div
					class="flex flex-row justify-between rounded-lg border border-green-800 bg-green-900/30 px-3 py-2 text-sm text-green-400"
				>
					<div>
						{player.firstName}
						{player.lastName}
					</div>
					{player.sweaterNumber ?? '--'}
				</div>
			{:else if selectable}
				<button
					onclick={() => game.guess(player.id)}
					class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all hover:scale-105"
					style="border-color: {primaryColor ?? '#555'}; background: {primaryColor ??
						'#555'}22; color: white;"
				>
					{player.firstName}
					{player.lastName}
				</button>
			{:else}
				<div class="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-gray-600">
					{player.firstName}
					{player.lastName}
				</div>
			{/if}
		{/each}
	</div>
{/snippet}

{#snippet rosterGroups()}
	<div class="flex flex-col gap-4">
		<div>
			<p class="mb-1.5 text-xs font-semibold tracking-wider text-gray-500 uppercase">
				{i18n.m.game.groups.forwards(gender)}
			</p>
			{@render playerGrid(forwards)}
		</div>
		<div>
			<p class="mb-1.5 text-xs font-semibold tracking-wider text-gray-500 uppercase">
				{i18n.m.game.groups.defense(gender)}
			</p>
			{@render playerGrid(defensemen)}
		</div>
		<div>
			<p class="mb-1.5 text-xs font-semibold tracking-wider text-gray-500 uppercase">
				{i18n.m.game.groups.goalies(gender)}
			</p>
			{@render playerGrid(goalies)}
		</div>
		{#if other.length > 0}
			<div>
				<p class="mb-1.5 text-xs font-semibold tracking-wider text-gray-500 uppercase">
					{i18n.m.game.groups.other}
				</p>
				{@render playerGrid(other)}
			</div>
		{/if}
	</div>
{/snippet}

<!-- The one roster surface, at every size; gone once the piles are empty and
     there is nothing left to guess. -->
{#if game.current}
	<div
		bind:this={layout.drawerEl}
		class="flex min-h-0 flex-col overflow-hidden bg-gray-900 {layout.rightDrawer
			? 'drawer-right shrink-0 self-stretch'
			: 'fixed right-0 bottom-0 left-0 z-40 rounded-t-2xl border-t border-white/10 shadow-2xl'}"
		style:max-height={layout.drawerMax === null ? undefined : `${layout.drawerMax}px`}
	>
		<!-- Handle / toggle. The grab bar reads as "drag me" on the bottom sheet;
		     on the side panel the label carries it alone. -->
		<button
			onclick={() => layout.toggleDrawer()}
			class="flex w-full shrink-0 flex-col items-center gap-1.5 px-4 pt-3 pb-2"
			aria-label={layout.drawerOpen ? i18n.m.game.collapseRoster : i18n.m.game.expandRoster}
		>
			{#if !layout.rightDrawer}
				<div class="h-1 w-10 rounded-full bg-white/20"></div>
			{/if}
			<span class="text-xs text-gray-500">
				{layout.drawerOpen ? `▼ ${i18n.m.game.hideRoster}` : `▲ ${i18n.m.game.showAll}`}
			</span>
		</button>

		{#if layout.drawerOpen}
			<!-- Expanded: full roster, scrolling only once the drawer has taken
			     all the space available to it. The number being asked about isn't
			     repeated here — the drawer does not cover the card that shows it. -->
			<div class="@container min-h-0 flex-1 overflow-y-auto px-4 pb-8">
				{@render rosterGroups()}
			</div>
		{:else}
			<!-- Collapsed: active options only -->
			<div class="min-h-0 flex-1 overflow-y-auto px-4 pb-4" bind:this={layout.optionsBox}>
				<div
					class="grid gap-1.5"
					style="grid-template-columns: repeat({layout.optionColumns}, minmax(0, 1fr));"
				>
					{#each game.activeOptions as player (player.id)}
						<button
							onclick={() => game.guess(player.id)}
							class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95"
							style="border-color: {primaryColor ?? '#555'}; background: {primaryColor ??
								'#555'}22; color: white;"
						>
							{player.firstName}
							{player.lastName}
						</button>
					{/each}
				</div>
			</div>
		{/if}
	</div>
{/if}

<style>
	/* The right-hand panel grows with the window so a desktop gets a roster
	   several columns wide, but never past 34rem — beyond that it is just
	   stealing width from the cards. The floor keeps one readable column on a
	   landscape phone. */
	.drawer-right {
		width: clamp(18rem, 40vw, 34rem);
	}
</style>
