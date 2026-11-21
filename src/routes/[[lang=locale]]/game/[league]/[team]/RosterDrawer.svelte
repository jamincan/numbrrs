<script lang="ts">
	import type { DrawerLayout } from '#lib/drawer-layout.svelte.ts';
	import type { GameState } from '#lib/game-state.svelte.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import type { Gender } from '#lib/i18n/index.ts';
	import { FORWARD_POSITION_CODES, KNOWN_POSITION_CODES } from '#lib/i18n/messages.ts';
	import type { Player } from '#lib/types.ts';

	const i18n = getI18n();

	let {
		roster,
		game,
		gender,
		layout,
		primaryColor,
		onguess,
		choices = $bindable()
	}: {
		roster: Player[];
		game: GameState;
		gender: Gender;
		layout: DrawerLayout;
		primaryColor: string;
		onguess: (playerId: number) => void;
		/** Whatever currently wraps the answer buttons, for the parent to move
		 *  focus to. */
		choices?: HTMLElement;
	} = $props();

	const uid = $props.id();

	const toggleLabel = $derived(layout.drawerOpen ? i18n.m.game.hideRoster : i18n.m.game.showAll);

	const forwards = $derived(
		roster.filter((player) =>
			(FORWARD_POSITION_CODES as readonly string[]).includes(player.positionCode)
		)
	);
	const defensemen = $derived(roster.filter((player) => player.positionCode === 'D'));
	const goalies = $derived(roster.filter((player) => player.positionCode === 'G'));
	const other = $derived(
		roster.filter(
			(player) => !(KNOWN_POSITION_CODES as readonly string[]).includes(player.positionCode)
		)
	);
</script>

{#snippet optionButton(player: Player, interaction: string)}
	<button
		onclick={() => onguess(player.id)}
		class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all {interaction}"
		style="border-color: {primaryColor}; background: {primaryColor}22; color: white;"
	>
		{player.firstName}
		{player.lastName}
	</button>
{/snippet}

{#snippet playerGrid(group: Player[])}
	<!-- Columns follow the container, not the viewport: this grid renders at
	     widths from a narrow landscape-phone panel to a full-width bottom
	     drawer on a tablet. -->
	<ul class="grid grid-cols-1 gap-1.5 @min-[20rem]:grid-cols-2 @min-[30rem]:grid-cols-3">
		{#each group as player (player.id)}
			{@const identified = game.identified.includes(player.id)}
			{@const selectable = game.current?.optionIds.includes(player.id) ?? false}
			{#if identified}
				<li
					class="flex flex-row justify-between rounded-lg border border-green-800 bg-green-900/30 px-3 py-2 text-sm text-green-400"
				>
					<div>
						{player.firstName}
						{player.lastName}
					</div>
					{player.sweaterNumber ?? '--'}
				</li>
			{:else if selectable}
				<!-- A one-cell grid, so the button still stretches to the height of
				     its row the way it would as the grid item itself. -->
				<li class="grid">
					{@render optionButton(player, 'hover:scale-105')}
				</li>
			{:else}
				<li class="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-gray-600">
					{player.firstName}
					{player.lastName}
				</li>
			{/if}
		{/each}
	</ul>
{/snippet}

{#snippet rosterGroup(heading: string, group: Player[])}
	<div>
		<h2 class="mb-1.5 text-xs font-semibold tracking-wider text-gray-500 uppercase">
			{heading}
		</h2>
		{@render playerGrid(group)}
	</div>
{/snippet}

{#snippet rosterByPosition()}
	{@render rosterGroup(i18n.m.game.groups.forwards(gender), forwards)}
	{@render rosterGroup(i18n.m.game.groups.defense(gender), defensemen)}
	{@render rosterGroup(i18n.m.game.groups.goalies(gender), goalies)}
	{#if other.length > 0}
		{@render rosterGroup(i18n.m.game.groups.other, other)}
	{/if}
{/snippet}

<!-- `choices` is where focus goes after a guess, whichever shape the drawer is
     in: the button that was pressed is usually gone by then, and focus left on
     nothing sends a keyboard or screen reader user back to the top of the
     page. tabindex -1 keeps the wrapper itself out of the tab order. -->
{#snippet rosterGroups()}
	<div
		bind:this={choices}
		role="group"
		tabindex="-1"
		aria-label={i18n.m.game.answerChoices}
		class="flex flex-col gap-4"
	>
		{@render rosterByPosition()}
	</div>
{/snippet}

<!-- The one roster surface, at every size; gone once the piles are empty and
     there is nothing left to guess. Before the first deal it is here in the
     shape the server has to assume — along the bottom, closed. -->
{#if game.current || !game.dealt}
	<div
		bind:this={layout.drawerEl}
		class="flex min-h-0 flex-col overflow-hidden bg-gray-900 {layout.rightDrawer
			? 'drawer-right shrink-0 self-stretch'
			: 'fixed right-0 bottom-0 left-0 z-40 rounded-t-2xl border-t border-white/10 shadow-2xl'}"
		style:max-height={layout.drawerMax === null ? undefined : `${layout.drawerMax}px`}
	>
		<!-- Handle / toggle. The grab bar reads as "drag me" on the bottom sheet;
		     on the side panel the label carries it alone. The button's name is the
		     words it shows and nothing else, so what a voice-control user reads
		     out is what activates it, and a screen reader isn't left to describe
		     the arrow. -->
		<button
			onclick={() => layout.toggleDrawer()}
			class="flex w-full shrink-0 flex-col items-center gap-1.5 px-4 pt-3 pb-2"
			aria-label={toggleLabel}
			aria-expanded={layout.drawerOpen}
			aria-controls="{uid}-roster"
		>
			{#if !layout.rightDrawer}
				<div class="h-1 w-10 rounded-full bg-white/20"></div>
			{/if}
			<span class="text-xs text-gray-500">
				{layout.drawerOpen ? '▼' : '▲'}
				{toggleLabel}
			</span>
		</button>

		{#if layout.drawerOpen}
			<!-- Expanded: full roster, scrolling only once the drawer has taken
			     all the space available to it. The number being asked about isn't
			     repeated here — the drawer does not cover the card that shows it. -->
			<div id="{uid}-roster" class="@container min-h-0 flex-1 overflow-y-auto px-4 pb-8">
				{@render rosterGroups()}
			</div>
		{:else}
			<!-- Collapsed: active options only -->
			<div
				id="{uid}-roster"
				class="min-h-0 flex-1 overflow-y-auto px-4 pb-4"
				bind:this={layout.optionsBox}
			>
				<div
					bind:this={choices}
					role="group"
					tabindex="-1"
					aria-label={i18n.m.game.answerChoices}
					class="grid gap-1.5"
					style="grid-template-columns: repeat({layout.optionColumns}, minmax(0, 1fr));"
				>
					{#each game.activeOptions as player (player.id)}
						{@render optionButton(player, 'active:scale-95')}
					{/each}
				</div>
				{#if !game.dealt}
					<!-- The whole roster, in the page as the server sends it: what "show
					     all" opens, there for a reader that never runs the script which
					     would open it. Hidden like the rest of a closed drawer, and gone
					     once the cards are dealt, when the toggle above takes over. It
					     gives nothing away: no card is up yet, and nobody's number is
					     shown until they have been identified. -->
					<div hidden>
						{@render rosterByPosition()}
					</div>
				{/if}
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
