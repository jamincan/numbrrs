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
		onnext,
		choices = $bindable()
	}: {
		roster: Player[];
		game: GameState;
		gender: Gender;
		layout: DrawerLayout;
		primaryColor: string;
		onguess: (playerId: number) => void;
		/** Move on from a player being introduced. */
		onnext: () => void;
		/** Whatever currently wraps the answer buttons, for the parent to move
		 *  focus to. */
		choices?: HTMLElement;
	} = $props();

	const uid = $props.id();

	// At a closed-book level the roster is a list of names and nothing more:
	// a number shown beside one would be an answer to rule out, or to read off.
	// Only once the cards are dealt, though: the level comes from this browser's
	// storage, and until then the markup has to be what the server sent.
	const closed = $derived(game.dealt && game.closedBook);

	// An introduction has nothing to answer: its one control is the way on.
	const introducing = $derived(game.current?.kind === 'intro');

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

{#snippet nextButton()}
	<button
		onclick={onnext}
		class="w-full rounded-lg border-2 px-3 py-2 text-center text-sm font-semibold transition-all active:scale-95"
		style="border-color: {primaryColor}; background: {primaryColor}22; color: white;"
	>
		{i18n.m.game.next}
	</button>
{/snippet}

{#snippet playerGrid(group: Player[])}
	<!-- Columns follow the container, not the viewport: this grid renders at
	     widths from a narrow landscape-phone panel to a full-width bottom
	     drawer on a tablet. -->
	<ul class="grid grid-cols-1 gap-1.5 @min-[20rem]:grid-cols-2 @min-[30rem]:grid-cols-3">
		{#each group as player (player.id)}
			{@const selectable = game.current?.optionIds.includes(player.id) ?? false}
			<!-- A player with no number has nothing to give away, so is marked as
			     done at every level. -->
			{@const revealed =
				game.identified.includes(player.id) && (!closed || player.sweaterNumber == null)}
			<!-- An answer first, whatever else is known about the player: while
			     Learn is introducing a roster, players already learned are still
			     offered, and one shown with their number beside them would be an
			     answer to rule out at a glance. -->
			{#if selectable}
				<!-- A one-cell grid, so the button still stretches to the height of
				     its row the way it would as the grid item itself. -->
				<li class="grid">
					{@render optionButton(player, 'hover:scale-105')}
				</li>
			{:else if revealed}
				<li
					class="flex flex-row justify-between rounded-lg border border-green-800 bg-green-900/30 px-3 py-2 text-sm text-green-400"
				>
					<div>
						{player.firstName}
						{player.lastName}
					</div>
					{player.sweaterNumber ?? '--'}
				</li>
			{:else}
				<li class="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-gray-450">
					{player.firstName}
					{player.lastName}
				</li>
			{/if}
		{/each}
	</ul>
{/snippet}

{#snippet rosterGroup(heading: string, group: Player[])}
	<div>
		<h2 class="mb-1.5 text-xs font-semibold tracking-wider text-gray-450 uppercase">
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
		<!-- Above the roster, where it is in reach without scrolling. -->
		{#if introducing}
			{@render nextButton()}
		{/if}
		{@render rosterByPosition()}
	</div>
{/snippet}

<!-- The one roster surface, at every size; gone once the piles are empty and
     there is nothing left to guess.

     Along the bottom or down the right is the stylesheet's choice (the `side`
     variant), so the server's markup is in the right place before any script
     has run. Before the first deal the server cannot know which it will be,
     and the pieces that differ between the two — the label, and whether the
     roster is showing — are both here, with the stylesheet picking.

     The right-hand panel grows with the window so a desktop gets a roster
     several columns wide, but never past 34rem — beyond that it is just
     stealing width from the cards. The floor keeps one readable column on a
     landscape phone. Its height is measured by the script; until that has
     run, the panel is held to what the measurement will come to — the
     viewport less the nav and the rafters row, 5rem between them — so a long roster cannot
     stretch the page in the meantime. -->
{#if game.current || !game.dealt}
	<div
		bind:this={layout.drawerEl}
		class="fixed right-0 bottom-0 left-0 z-40 flex min-h-0 flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-gray-900 shadow-2xl side:static side:z-auto side:col-start-2 side:row-start-2 side:max-h-[calc(100dvh-5rem)] side:w-[clamp(18rem,40vw,34rem)] side:shrink-0 side:self-stretch side:rounded-none side:border-t-0 side:shadow-none"
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
			aria-label={game.dealt ? toggleLabel : undefined}
			aria-expanded={game.dealt ? layout.drawerOpen : undefined}
			aria-controls="{uid}-roster"
		>
			<div class="h-1 w-10 rounded-full bg-white/20 side:hidden"></div>
			<span class="text-xs text-gray-450">
				{#if game.dealt}
					{layout.drawerOpen ? '▼' : '▲'}
					{toggleLabel}
				{:else}
					<!-- Not yet a working toggle, and not yet known to be open or
					     closed: the button is named by whichever label shows. -->
					<span class="side:hidden">▲ {i18n.m.game.showAll}</span>
					<span class="hidden side:inline">▼ {i18n.m.game.hideRoster}</span>
				{/if}
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
			<!-- Collapsed: active options only. Before the first deal it is a
			     container as well, and padded like the open drawer in the
			     right-hand arrangement, because there it is showing the roster. -->
			<div
				id="{uid}-roster"
				class="min-h-0 flex-1 overflow-y-auto px-4 pb-4 {game.dealt ? '' : '@container side:pb-8'}"
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
					{#if introducing}
						<!-- Across the whole row, however many columns the answers had. -->
						<div class="col-span-full">
							{@render nextButton()}
						</div>
					{/if}
					{#each game.activeOptions as player (player.id)}
						{@render optionButton(player, 'active:scale-95')}
					{/each}
				</div>
				{#if !game.dealt}
					<!-- The whole roster, in the page as the server sends it: what "show
					     all" opens, there for a reader that never runs the script which
					     would open it. Along the bottom it is hidden like the rest of a
					     closed drawer; down the right it shows, as the open panel it is
					     about to become. Gone once the cards are dealt, when the toggle
					     above takes over. It gives nothing away: no card is up yet, and
					     nobody's number is shown until they have been identified. -->
					<div class="hidden flex-col gap-4 side:flex">
						{@render rosterByPosition()}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}
