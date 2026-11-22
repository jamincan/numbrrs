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

	// The drawer shows the roster or, shut, only the answers on the card that's
	// up: the same list under the same position headings, in the same order,
	// with everyone else left out.
	//
	// Where everyone with a number is an answer there is nobody to leave out:
	// Hard, or any closed-book level on a roster no bigger than its cards. The
	// two are then the same thing, the toggle between them has nothing to do,
	// and it is not shown.
	//
	// Only at a closed book. While Learn is introducing a small roster the
	// answers can be everyone met so far, but the open roster still has more
	// to show than they do.
	const everyone = $derived(
		closed &&
			game.current?.kind === 'quiz' &&
			roster.every((p) => p.sweaterNumber == null || game.current?.optionIds.includes(p.id))
	);
	// What the drawer shows: the roster, or only the answers.
	const showRoster = $derived(layout.drawerOpen || everyone);

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

<!-- Everything in the drawer is a little shorter on a phone, where it comes up
     from the bottom and what it takes it takes from the cards: the rows, the
     space under a heading and between one position and the next, and the
     handle. Ten answers under three headings then fit without scrolling on a
     phone of ordinary height. With more room (a tablet, or the side panel)
     they are their full size. A row is still 32px tall and half the screen
     wide, which is plenty to hit. -->
{#snippet optionButton(player: Player, interaction: string)}
	<button
		onclick={() => onguess(player.id)}
		class="w-full rounded-lg border-2 px-3 py-1 text-left text-sm font-semibold transition-all sm:py-2 side:py-2 {interaction}"
		style="border-color: {primaryColor}; background: {primaryColor}22; color: white;"
	>
		{player.firstName}
		{player.lastName}
	</button>
{/snippet}

{#snippet nextButton()}
	<button
		onclick={onnext}
		class="w-full rounded-lg border-2 px-3 py-1 text-center text-sm font-semibold transition-all active:scale-95 sm:py-2 side:py-2"
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
					class="flex flex-row justify-between rounded-lg border border-green-800 bg-green-900/30 px-3 py-1 text-sm text-green-400 sm:py-2 side:py-2"
				>
					<div>
						{player.firstName}
						{player.lastName}
					</div>
					{player.sweaterNumber ?? '--'}
				</li>
			{:else}
				<li
					class="rounded-lg border border-white/5 bg-white/5 px-3 py-1 text-sm text-gray-450 sm:py-2 side:py-2"
				>
					{player.firstName}
					{player.lastName}
				</li>
			{/if}
		{/each}
	</ul>
{/snippet}

{#snippet rosterGroup(heading: string, group: Player[])}
	<div>
		<h2
			class="mb-1 text-xs font-semibold tracking-wider text-gray-450 uppercase sm:mb-1.5 side:mb-1.5"
		>
			{heading}
		</h2>
		{@render playerGrid(group)}
	</div>
{/snippet}

<!-- One position's players among the answers on the card, in the roster's
     order. A position with none of them on the card is left out altogether: a
     heading over nothing says only that the answer is not there. -->
{#snippet answerGroup(heading: string, group: Player[])}
	{@const offered = group.filter((player) => game.current?.optionIds.includes(player.id))}
	{#if offered.length > 0}
		<div>
			<h2
				class="mb-1 text-xs font-semibold tracking-wider text-gray-450 uppercase sm:mb-1.5 side:mb-1.5"
			>
				{heading}
			</h2>
			<div
				data-answer-group
				class="grid gap-1.5"
				style="grid-template-columns: repeat({layout.optionColumns}, minmax(0, 1fr));"
			>
				{#each offered as player (player.id)}
					{@render optionButton(player, 'active:scale-95')}
				{/each}
			</div>
		</div>
	{/if}
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
		{#if everyone}
			<!-- No toggle, and no bar that looks like one: only the room they kept
			     above the first heading. -->
			<div class="h-4 shrink-0"></div>
		{:else}
			<button
				onclick={() => layout.toggleDrawer()}
				class="flex w-full shrink-0 flex-col items-center gap-1 px-4 pt-2 pb-1.5 sm:gap-1.5 sm:pt-3 sm:pb-2 side:gap-1.5 side:pt-3 side:pb-2"
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
		{/if}

		{#if showRoster}
			<!-- Expanded, or with everyone on offer: full roster, scrolling only once the drawer has taken
			     all the space available to it. The number being asked about isn't
			     repeated here — the drawer does not cover the card that shows it. -->
			<div id="{uid}-roster" class="@container min-h-0 flex-1 overflow-y-auto px-4 pb-8">
				{@render rosterGroups()}
			</div>
		{:else}
			<!-- Collapsed: the answers on the card and nobody else, under the
			     headings of the positions they play, as they are in the roster.
			     Before the first deal it is a container as well, and padded like
			     the open drawer in the right-hand arrangement, because there it is
			     showing the roster. -->
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
					class="flex flex-col gap-2 sm:gap-3 side:gap-3"
				>
					{#if introducing}
						{@render nextButton()}
					{/if}
					{@render answerGroup(i18n.m.game.groups.forwards(gender), forwards)}
					{@render answerGroup(i18n.m.game.groups.defense(gender), defensemen)}
					{@render answerGroup(i18n.m.game.groups.goalies(gender), goalies)}
					{@render answerGroup(i18n.m.game.groups.other, other)}
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
