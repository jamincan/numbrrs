<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import NavSlot from '#lib/components/NavSlot.svelte';
	import LevelMenu from './LevelMenu.svelte';
	import GameHeader from './GameHeader.svelte';
	import Rafters from './Rafters.svelte';
	import CardTable from './CardTable.svelte';
	import RosterDrawer from './RosterDrawer.svelte';
	import type { Player, Team } from '#lib/types.ts';
	import { DrawerLayout } from '#lib/drawer-layout.svelte.ts';
	import { levelForMedal, LEVELS, type LevelKey } from '#lib/game.ts';
	import { GameState, sessionGameStorage } from '#lib/game-state.svelte.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import { RecordBook } from '#lib/records.svelte.ts';
	import { leagueGender } from '#lib/leagues.ts';
	import { getTeamColors } from '#lib/team-colors.ts';
	import { teamName } from '#lib/team-names.ts';

	const i18n = getI18n();

	// Only rendered once the roster has arrived and has at least one numbered
	// player on it (the page checks isPlayable), so the game can assume it has
	// someone to ask about. For a roster the server already had, that includes
	// the server's own render.
	const { team, roster }: { team: Team; roster: Player[] } = $props();

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
	const name = $derived(teamName(i18n.locale, team));
	// French has no gender-neutral word for "players", so which set of nouns to
	// use is a property of the league — the PWHL takes the feminine forms.
	const gender = $derived(leagueGender(team.league));

	// Quiz state and drawer layout are their own reactive classes (see
	// #lib/game-state.svelte.ts and #lib/drawer-layout.svelte.ts) — neither
	// needs to react to `roster` changing, since the page mounts a new instance
	// of this component for each roster it is given. `untrack` says so
	// explicitly, rather than leaving it looking like an oversight.
	const game = new GameState(untrack(() => roster));
	const layout = new DrawerLayout(() => game.activeOptions.length);

	// The same goes for the team, which is the roster's own. Its id names the
	// saved game.
	const teamId = untrack(() => team.id);
	const storage = sessionGameStorage();

	// Medals and best scores, kept in this browser's local storage and read
	// once the page has mounted, like the game itself and for the same reason.
	const records = new RecordBook();
	const seasonMedal = $derived(records.loaded ? records.medal(teamId) : null);
	// Nothing to compare a round about a few players with: it isn't the roster.
	const best = $derived(records.loaded && !game.focus ? records.best(teamId, game.countsAs) : null);
	// Players on this roster the visitor has no record of naming, on a team they
	// have played to the end before: arrivals, and changes of number, since.
	const fresh = $derived(records.loaded ? records.newPlayers(teamId, roster) : []);

	// Once the last card is answered the roster panel is gone, and the page is
	// the cards and the summary alone.
	const over = $derived(game.dealt && !game.current);

	// The cards are dealt here rather than when the game is constructed. The
	// server renders this component too, and its markup is shared by everyone
	// the edge serves it to: nothing shuffled, and nothing read from this tab's
	// storage, can be in it — or in the first client render, which has to match
	// it. So both show an undealt deck, and the game in progress (or a fresh
	// shuffle) arrives once the component has mounted.
	onMount(() => {
		records.load();
		if (!game.restore(storage, teamId)) game.reset();
	});

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
		const foundBefore = game.identified.length;
		game.guess(playerId);
		game.save(storage, teamId);

		// A right answer adds the player it found to the end of the list. That
		// player and number are now ones this visitor has named correctly.
		const foundId = game.identified.length > foundBefore ? game.identified.at(-1) : undefined;
		const found = roster.find((p) => p.id === foundId);
		if (found?.sweaterNumber != null) records.learned(teamId, found.id, found.sweaterNumber);
		// The last card: the run goes on record. Only here, as it ends, and not
		// when a finished game is restored after a reload, or it would count twice.
		// A round about a few new players is not a run at the roster, and is left
		// out: two out of two would otherwise stand as the best score at Learn.
		if (!game.current && !game.focus) {
			records.runFinished(teamId, {
				level: game.countsAs,
				found: game.firstTry,
				total: game.guessableCount
			});
		}
		void refocus();
	}

	// On from an introduction, in Learn. Saved like a guess: which players have
	// been looked at is part of the game.
	function next() {
		game.next();
		game.save(storage, teamId);
		void refocus();
	}

	// A round of Learn about only the players who are new. Whatever game was
	// up is given up for it: this is asked for by name, on a button that says so.
	function learnNew() {
		game.setLevel('learn');
		game.reset(fresh.map((p) => p.id));
		game.save(storage, teamId);
		void refocus();
	}

	// From Learn's end screen to the first level with a medal. The level alone
	// would only be remembered for next time, the game being over; this deals it.
	function tryEasy() {
		game.setLevel('easy');
		game.reset();
		game.save(storage, teamId);
		void refocus();
	}

	// Saving a game with no guesses in it clears the finished one.
	function playAgain() {
		game.reset();
		game.save(storage, teamId);
		void refocus();
	}

	// Saved too, because the card that's up is kept along with its answers. A
	// change between Learn and a quiz level deals a new game, and saving that
	// clears the old one. Focus is only moved when it does: otherwise it is back
	// on the menu's button, where the menu put it.
	function setLevel(value: LevelKey) {
		const before = game.current?.key;
		game.setLevel(value);
		game.save(storage, teamId);
		if (game.guesses === 0 && game.current?.key !== before) void refocus();
	}
</script>

<svelte:window
	onresize={() => layout.measureDrawerSpace()}
	onscroll={() => layout.measureDrawerSpace()}
	bind:innerWidth={layout.viewportWidth}
/>

<!-- The level menu rides in the site nav rather than a header of its own,
     keeping the play area clear. -->
<NavSlot>
	<LevelMenu levels={LEVELS} value={game.level} onselect={setLevel} />
</NavSlot>

<!-- Which arrangement this is in is decided by the stylesheet (the `side`
     variant: see app.css), not by the script, so that the markup the server
     sends is already the page the visitor will see.

     min-h-0 in the right-hand layout lets this shrink to the height the flex
     chain gives it rather than to its content, which is what hands the overflow
     to the drawer's own scroller instead of the page. The bottom layout keeps
     the default so a page that genuinely outgrows the viewport can still scroll
     rather than clip. -->
<div class="flex flex-1 flex-col bg-gray-900 text-white side:min-h-0">
	<!-- Two arrangements of the same pieces. Under a bottom drawer they stack:
	     the rafters row flush beneath the nav, the team's name, the cards. With
	     the roster as a panel down the right they are two columns under a row,
	     a grid: the rafters across the top, then the name and the cards on the
	     left and the panel on the right.

	     That is where the screen is tall enough to give the row its height (the
	     `side-tall` variant). On a short one, which is a phone on its side, the
	     rafters are tucked over the panel instead and the card column runs the
	     full height of the left, so the row costs the cards no height where
	     height is what there is least of.

	     The right-hand panel is meant to sit flush against the nav and the
	     screen edge, so that layout takes no padding or max width of its own —
	     the breathing room goes on the card column instead. The bottom padding
	     on the other one is only for the case where the page is forced to
	     scroll anyway; the drawer otherwise sizes itself to the space under the
	     cards.

	     When the game is over there is no panel to put the rafters over, and
	     the stacked arrangement serves at every size. -->
	<main
		class="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-40 side:mx-0 side:min-h-0 side:max-w-none side:px-0 side:pb-0 {over
			? ''
			: 'side:grid side:grid-cols-[minmax(0,1fr)_clamp(18rem,40vw,34rem)] side:grid-rows-[auto_minmax(0,1fr)]'}"
	>
		<div
			class={over
				? ''
				: 'side:col-start-2 side:row-start-1 side-tall:col-span-2 side-tall:col-start-1'}
		>
			<Rafters
				medal={seasonMedal}
				medalTip={seasonMedal
					? i18n.m.game.medalTip(
							i18n.m.game.medals[seasonMedal],
							i18n.m.game.levels[levelForMedal(seasonMedal).key],
							records.season
						)
					: undefined}
			>
				{#snippet extra()}
					<!-- Gone while the round it starts is being played, and as soon as
					     the last of the new players has been named. Opaque, because
					     it lies over whatever is hanging at this end of the row. -->
					{#if game.dealt && fresh.length > 0 && !game.focus}
						<button
							onclick={learnNew}
							class="rounded-full border border-white/25 bg-gray-800 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-white shadow hover:bg-gray-700"
						>
							{i18n.m.game.learnNew(fresh.length, gender)}
						</button>
					{/if}
				{/snippet}
			</Rafters>
		</div>

		<!-- Once the game is over the column also holds the list of players
		     missed, which on a short screen is more than it has height for: it
		     scrolls then, rather than the list being cut off. Not before, so
		     that nothing clips the cards' glow while they are in play. -->
		<div
			class="flex min-w-0 flex-1 flex-col items-center side:min-h-0 side:justify-start side:gap-3 side:px-4 side:py-3 {over
				? 'side:overflow-y-auto'
				: 'side:col-start-1 side:row-span-2 side:row-start-1 side-tall:row-span-1 side-tall:row-start-2'}"
		>
			<!-- The title heads the card column in both arrangements. Over a
			     bottom drawer it spans the page; with the drawer on the right it
			     stays within the column. -->
			<GameHeader {name} color={colors.heading} inCardColumn />

			<CardTable
				{team}
				{game}
				{gender}
				{layout}
				onplayagain={playAgain}
				onrestart={playAgain}
				ontrylevel={tryEasy}
				{best}
				bind:summary
			/>
		</div>

		<RosterDrawer
			{roster}
			{game}
			{gender}
			{layout}
			primaryColor={colors.primary}
			onguess={guess}
			onnext={next}
			bind:choices
		/>
	</main>
</div>
