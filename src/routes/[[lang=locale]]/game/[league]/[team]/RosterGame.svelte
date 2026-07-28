<script lang="ts">
	import { untrack } from 'svelte';
	import NavSlot from '$lib/components/NavSlot.svelte';
	import DifficultyMenu from './DifficultyMenu.svelte';
	import GameHeader from './GameHeader.svelte';
	import CardTable from './CardTable.svelte';
	import RosterDrawer from './RosterDrawer.svelte';
	import type { Player, Team } from '$lib/types';
	import { DrawerLayout } from '$lib/drawer-layout.svelte';
	import { DIFFICULTY_OPTIONS, GameState } from '$lib/game-state.svelte';
	import { getI18n } from '$lib/i18n/state.svelte';
	import { leagueGender } from '$lib/leagues';
	import { getTeamColors } from '$lib/team-colors';
	import { teamName } from '$lib/team-names';

	const i18n = getI18n();

	// Only mounted once the roster has arrived and is non-empty, so the game can
	// assume it has players to ask about.
	const { team, roster }: { team: Team; roster: Player[] } = $props();

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
	const name = $derived(teamName(i18n.locale, team));
	// French has no gender-neutral word for "players", so which set of nouns to
	// use is a property of the league — the PWHL takes the feminine forms.
	const gender = $derived(leagueGender(team.league));

	// Quiz state and drawer layout are their own reactive classes (see
	// $lib/game-state.svelte.ts and $lib/drawer-layout.svelte.ts) — neither
	// needs to react to `roster` changing, since this component is only ever
	// mounted once a roster has arrived (see above). `untrack` says so
	// explicitly, rather than leaving it looking like an oversight.
	const game = new GameState(untrack(() => roster));
	const layout = new DrawerLayout(() => game.activeOptions.length);
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
		<GameHeader {name} color={colors?.primary} />
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
				<GameHeader {name} color={colors?.primary} compact />
			{/if}

			<CardTable {team} {game} {gender} {layout} />
		</div>

		<RosterDrawer {roster} {game} {gender} {layout} primaryColor={colors?.primary} />
	</main>
</div>
