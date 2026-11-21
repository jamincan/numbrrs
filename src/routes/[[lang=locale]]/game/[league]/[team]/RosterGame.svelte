<script lang="ts">
	import { tick, untrack } from 'svelte';
	import NavSlot from '#lib/components/NavSlot.svelte';
	import DifficultyMenu from './DifficultyMenu.svelte';
	import GameHeader from './GameHeader.svelte';
	import CardTable from './CardTable.svelte';
	import RosterDrawer from './RosterDrawer.svelte';
	import type { Player, Team } from '#lib/types.ts';
	import { DrawerLayout } from '#lib/drawer-layout.svelte.ts';
	import { DIFFICULTY_OPTIONS, GameState } from '#lib/game-state.svelte.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import { leagueGender } from '#lib/leagues.ts';
	import { getTeamColors } from '#lib/team-colors.ts';
	import { teamName } from '#lib/team-names.ts';

	const i18n = getI18n();

	// Only mounted once the roster has arrived and has at least one numbered
	// player on it (the page checks isPlayable), so the game can assume it has
	// someone to ask about.
	const { team, roster }: { team: Team; roster: Player[] } = $props();

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
	const name = $derived(teamName(i18n.locale, team));
	// French has no gender-neutral word for "players", so which set of nouns to
	// use is a property of the league — the PWHL takes the feminine forms.
	const gender = $derived(leagueGender(team.league));

	// Quiz state and drawer layout are their own reactive classes (see
	// #lib/game-state.svelte.ts and #lib/drawer-layout.svelte.ts) — neither
	// needs to react to `roster` changing, since this component is only ever
	// mounted once a roster has arrived (see above). `untrack` says so
	// explicitly, rather than leaving it looking like an oversight.
	const game = new GameState(untrack(() => roster));
	const layout = new DrawerLayout(() => game.activeOptions.length);

	// A guess removes the button that made it, the last guess removes the whole
	// drawer, and Play Again removes itself — each time the control that held
	// focus is gone by the next render, and the browser's answer to that is to
	// drop focus back to the top of the document. So after either move, focus is
	// handed to whatever replaced it: the answer buttons' wrapper, or the
	// summary once there is nothing left to guess.
	//
	// The wrappers rather than a button inside them: landing on a button would
	// read out one player's name as though it were the answer, and a key still
	// held from the last press would press it. preventScroll because this runs
	// for pointer users too, who didn't ask for the page to move.
	let choices = $state<HTMLElement>();
	let summary = $state<HTMLElement>();

	async function refocus() {
		await tick();
		(game.current ? choices : summary)?.focus({ preventScroll: true });
	}

	function guess(playerId: number) {
		game.guess(playerId);
		void refocus();
	}

	function playAgain() {
		game.reset();
		void refocus();
	}
</script>

<svelte:window
	onresize={() => layout.measureDrawerSpace()}
	onscroll={() => layout.measureDrawerSpace()}
	bind:innerWidth={layout.viewportWidth}
/>

<!-- The difficulty menu rides in the site nav rather than a header of its own,
     keeping the play area clear. -->
<NavSlot>
	<DifficultyMenu
		options={DIFFICULTY_OPTIONS}
		value={game.difficulty}
		onselect={(value) => game.setDifficulty(value)}
	/>
</NavSlot>

<!-- min-h-0 in the right-hand layout lets this shrink to the height the flex
     chain gives it rather than to its content, which is what hands the overflow
     to the drawer's own scroller instead of the page. The bottom layout keeps
     the default so a page that genuinely outgrows the viewport can still scroll
     rather than clip. -->
<div class="flex flex-1 flex-col bg-gray-900 text-white {layout.rightDrawer ? 'min-h-0' : ''}">
	<!-- With the drawer on the right the title moves down into the card column
	     instead of spanning the width, so the panel gets the full height under
	     the nav to work with. -->
	{#if !layout.rightDrawer}
		<GameHeader {name} color={colors.heading} />
	{/if}

	<!-- Two arrangements of the same pieces. The right-hand panel is meant to
	     sit flush against the nav and the screen edge, so that layout takes no
	     padding or max width of its own — the breathing room goes on the card
	     column instead. The bottom padding on the other one is only for the
	     case where the page is forced to scroll anyway; the drawer otherwise
	     sizes itself to the space under the cards. -->
	<main
		class="flex w-full flex-1 {layout.rightDrawer
			? 'min-h-0 flex-row'
			: 'mx-auto max-w-6xl flex-col px-4 pb-40'}"
	>
		<div
			class="flex min-w-0 flex-1 flex-col items-center {layout.rightDrawer
				? 'min-h-0 justify-start gap-3 px-4 py-3'
				: 'gap-8'}"
		>
			{#if layout.rightDrawer}
				<GameHeader {name} color={colors.heading} compact />
			{/if}

			<CardTable {team} {game} {gender} {layout} onplayagain={playAgain} bind:summary />
		</div>

		<RosterDrawer
			{roster}
			{game}
			{gender}
			{layout}
			primaryColor={colors.primary}
			onguess={guess}
			bind:choices
		/>
	</main>
</div>
