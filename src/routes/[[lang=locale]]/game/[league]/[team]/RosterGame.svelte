<script lang="ts">
	import { browser } from '$app/environment';
	import CardBack from '$lib/components/CardBack.svelte';
	import HockeyCard from '$lib/components/HockeyCard.svelte';
	import NavSlot from '$lib/components/NavSlot.svelte';
	import DifficultyMenu from './DifficultyMenu.svelte';
	import GameHeader from './GameHeader.svelte';
	import type { Player, Team } from '$lib/types';
	import { buildDeck, cardOptions, drawCard, preIdentifiedIds } from '$lib/game';
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

	const forwards = $derived(
		roster.filter((player) => ['L', 'C', 'R', 'F'].includes(player.positionCode))
	);
	const defensemen = $derived(roster.filter((player) => player.positionCode === 'D'));
	const goalies = $derived(roster.filter((player) => player.positionCode === 'G'));
	const other = $derived(
		roster.filter((player) => !['L', 'C', 'R', 'F', 'D', 'G'].includes(player.positionCode))
	);

	const DIFFICULTY_KEY = 'numbrrs_difficulty';
	const DIFFICULTY_OPTIONS = [
		{ key: 'easy', value: 2 },
		{ key: 'medium', value: 4 },
		{ key: 'hard', value: 8 },
		{ key: 'expert', value: Infinity }
	] as const;

	// Anything unexpected in storage (an old format, a hand-edited value) falls
	// back to easy — Number(junk) is NaN, and NaN options would break the quiz.
	function savedDifficulty(): number {
		if (!browser) return 2;
		const stored = Number(localStorage.getItem(DIFFICULTY_KEY));
		return DIFFICULTY_OPTIONS.some((o) => o.value === stored) ? stored : 2;
	}

	let difficulty = $state(savedDifficulty());

	$effect(() => {
		localStorage.setItem(DIFFICULTY_KEY, String(difficulty));
	});

	let drawerOpen = $state(false);

	// The quiz is a physical deck. A card is drawn from the pile and shows its
	// number; a guess flips it and sends it to the guessed pile, where it stays
	// readable while the next card is already up — so there is no reveal phase
	// that blocks play, and no auto-advance timer.
	type ActiveCard = { key: number; player: Player; optionIds: number[] };
	type ResolvedCard = { key: number; player: Player; correct: boolean };

	type GameState = {
		/** Face-down draw pile; the top card gets dealt into `current`. */
		deck: Player[];
		/** Players whose card resolved without them being identified; reshuffled
		 *  into a fresh deck when the draw pile runs out. */
		recycle: Player[];
		identified: number[];
		guesses: number;
		/** The drawn card being guessed at; null once both piles run dry (game over). */
		current: ActiveCard | null;
		/** The most recent guess, face-up on top of the guessed pile. */
		resolved: ResolvedCard | null;
		/** The card underneath it — visible while the newest one flies in, and
		 *  peeking out at an angle after it lands. */
		previous: ResolvedCard | null;
	};

	// Cards are keyed by draw, not by player: a recycled player gets a fresh
	// card element, so no card on screen ever mutates its face. The counter
	// never resets (not even on Play Again) so a key can't collide with a
	// still-transitioning element from the previous game.
	let nextKey = 0;

	/** Deal the top card, with its answer options at the current difficulty. */
	function dealt(
		drawn: ReturnType<typeof drawCard<Player>>,
		identified: number[]
	): ActiveCard | null {
		return (
			drawn && {
				key: nextKey++,
				player: drawn.player,
				optionIds: cardOptions(roster, identified, drawn.player, difficulty)
			}
		);
	}

	/**
	 * A fresh game: nothing guessed yet beyond the numberless players. A roster
	 * where nobody has a number deals no cards, so it starts (and stays) on the
	 * summary instead of crashing on a question that can't be built.
	 */
	function initialState(): GameState {
		const identified = preIdentifiedIds(roster);
		const drawn = drawCard(buildDeck(roster), []);
		return {
			deck: drawn?.deck ?? [],
			recycle: [],
			identified,
			guesses: 0,
			current: dealt(drawn, identified),
			resolved: null,
			previous: null
		};
	}

	let game = $state<GameState>(initialState());

	const guessableCount = $derived(roster.length - preIdentifiedIds(roster).length);

	// In the shuffled order the card chose — deriving this by filtering the
	// roster would quietly re-impose roster order instead.
	const activeOptions = $derived(
		game.current
			? game.current.optionIds.flatMap((id) => roster.find((p) => p.id === id) ?? [])
			: []
	);

	function guessPlayer(playerId: number) {
		const card = game.current;
		if (!card) return;
		drawerOpen = false;
		const guessed = roster.find((p) => p.id === playerId);
		const answer = card.player.sweaterNumber;
		// Teams regularly carry two players on one number over a season — someone
		// departs and their replacement takes the sweater. The card only shows a
		// number, so every player wearing it is a right answer; picking the one the
		// card wasn't built from isn't a mistake. Only the player actually picked
		// is identified though, so the other still has to be found later.
		const correct = guessed != null && answer != null && guessed.sweaterNumber === answer;
		const identified = correct ? [...game.identified, guessed.id] : game.identified;
		// The guessed player's own card is done wherever it sits, deck or recycle
		// pile — their number has been learned.
		const deck = correct ? game.deck.filter((p) => p.id !== guessed.id) : game.deck;
		const recycle = correct ? game.recycle.filter((p) => p.id !== guessed.id) : game.recycle;
		// The resolved card is discarded only if its own player is now identified;
		// otherwise it returns to the pool — after a wrong guess, or a right guess
		// that identified the number's other wearer.
		const pool = identified.includes(card.player.id) ? recycle : [...recycle, card.player];
		const drawn = drawCard(deck, pool);
		game = {
			deck: drawn?.deck ?? [],
			recycle: drawn?.recycle ?? [],
			identified,
			guesses: game.guesses + 1,
			current: dealt(drawn, identified),
			// Reveal whoever was picked when the guess was right, not whichever
			// player the card happened to be built from — showing the other one
			// reads as a correction when the answer was accepted.
			resolved: { key: card.key, player: correct ? guessed : card.player, correct },
			previous: game.resolved
		};
	}

	// The drawer sizes itself to its content, capped at the free space between
	// the bottom of the card table and the bottom of the viewport — as much
	// room as it can take without covering the decks, and no forced inner
	// scrolling before that.
	let cardTable = $state<HTMLElement>();
	let drawerMax = $state<number | null>(null);
	let viewportWidth = $state(0);
	function measureDrawerSpace() {
		if (!cardTable) return;
		drawerMax = Math.max(window.innerHeight - cardTable.getBoundingClientRect().bottom - 8, 96);
	}
	$effect(measureDrawerSpace);

	/** `gap-1.5` between option buttons, in px. */
	const OPTION_GAP = 6;
	/** Narrower than this and a third column stops being worth reading. */
	const MIN_OPTION_WIDTH = 150;

	// Two columns is the default: wider targets, easier to read. A third only
	// appears when two would overflow the drawer and the screen is wide enough
	// to take it — mostly expert difficulty on a tablet or a phone in
	// landscape.
	let optionsBox = $state<HTMLElement>();
	let optionColumns = $state(2);
	$effect(() => {
		// Re-measure whenever the option count, the drawer's budget or the
		// viewport width changes.
		void [activeOptions.length, drawerMax, viewportWidth, drawerOpen];
		const box = optionsBox;
		if (!box || drawerMax === null) return;
		const cells = [...box.querySelectorAll<HTMLElement>('button')];
		if (cells.length === 0) return;
		// Grid rows are as tall as their tallest cell, so a wrapped name sets
		// the height for its whole row. Taking the tallest biases the estimate
		// toward granting the third column, which is the harmless direction:
		// three columns never needs more height than two.
		const rowHeight = Math.max(...cells.map((cell) => cell.offsetHeight));
		const padding = parseFloat(getComputedStyle(box).paddingBottom) || 0;
		// The drawer's whole allowance, less the handle above the grid and the
		// grid's own bottom padding. Measured from the budget rather than the
		// box's current height, which only reports how tall the content
		// happens to be when it fits.
		const available = drawerMax - box.offsetTop - padding;
		if (rowHeight <= 0 || available <= 0) return;
		const rowsThatFit = Math.max(
			1,
			Math.floor((available + OPTION_GAP) / (rowHeight + OPTION_GAP))
		);
		const widthAllows = Math.floor(
			(box.clientWidth + OPTION_GAP) / (MIN_OPTION_WIDTH + OPTION_GAP)
		);
		optionColumns = cells.length > rowsThatFit * 2 ? Math.min(3, Math.max(2, widthAllows)) : 2;
	});

	// The resolved card mounts still showing its number, then flips a frame
	// later — a CSS transition can't animate on initial render, and the card
	// needs to fly to the pile face-front before turning over.
	let shownCorrect = $state<boolean | null>(null);
	$effect(() => {
		const outcome = game.resolved?.correct;
		shownCorrect = null;
		if (outcome === undefined) return;
		let secondFrame = 0;
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				shownCorrect = outcome;
			});
		});
		return () => {
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
		};
	});
</script>

<svelte:window
	onresize={measureDrawerSpace}
	onscroll={measureDrawerSpace}
	bind:innerWidth={viewportWidth}
/>

<!-- The difficulty menu rides in the site nav rather than a header of its own,
     keeping the play area clear. -->
<NavSlot>
	<DifficultyMenu
		options={DIFFICULTY_OPTIONS}
		value={difficulty}
		onselect={(value) => {
			difficulty = value;
			if (!game.current) return;
			// Same card, refreshed options: the drawn number stays the question,
			// only how many candidates surround it changes.
			game = {
				...game,
				current: {
					...game.current,
					optionIds: cardOptions(roster, game.identified, game.current.player, difficulty)
				}
			};
		}}
	/>
</NavSlot>

<div class="flex-1 bg-gray-900 text-white">
	<GameHeader {name} color={colors?.primary} />

	<!-- The mobile padding only matters when the page is forced to scroll (a
	     short landscape viewport): enough to pull the progress line clear of
	     the drawer, not a full reservation — the drawer sizes itself to the
	     space under the cards instead. -->
	<main class="mx-auto max-w-6xl px-4 pb-40 lg:pb-12">
		{#snippet playerGrid(group: typeof roster)}
			<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
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
							onclick={() => guessPlayer(player.id)}
							class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all hover:scale-105"
							style="border-color: {colors?.primary ?? '#555'}; background: {colors?.primary ??
								'#555'}22; color: white;"
						>
							{player.firstName}
							{player.lastName}
						</button>
					{:else}
						<div
							class="rounded-lg border border-white/5 bg-white/5 px-3 py-2 text-sm text-gray-600"
						>
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

		<div class="flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center">
			<!-- The card table: draw deck on the left, guessed pile on the right.
			     One row at every breakpoint — the cards scale down instead of
			     re-stacking, which also keeps the fly-to-pile animation a constant
			     "one zone-width plus the gap". -->
			<div
				bind:this={cardTable}
				class="flex w-full max-w-xl flex-col items-center gap-4 lg:w-[37rem] lg:shrink-0"
			>
				<div class="flex w-full items-start justify-center gap-4">
					<!-- Draw deck -->
					<div class="relative aspect-[3/4] w-full max-w-72 flex-1">
						{#if game.current}
							{@const backs = Math.min(game.deck.length, 3)}
							{#each { length: backs }, i}
								<div
									class="absolute inset-0"
									style="transform: translate({(backs - i) * 4}px, {(backs - i) * 4}px);"
									aria-hidden="true"
								>
									<CardBack {team} />
								</div>
							{/each}
							{#key game.current.key}
								<div class="card-draw absolute inset-0">
									<HockeyCard {team} player={game.current.player} correct={null} />
								</div>
							{/key}
						{:else}
							<!-- Game over: the summary takes the emptied deck's spot. -->
							<div
								class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-green-500/30 bg-green-500/5 p-4 text-center"
							>
								<h2 class="text-xl font-bold text-green-400 sm:text-2xl">
									{i18n.m.game.congratulations}
								</h2>
								<!-- The team name is in the header rather than this sentence:
								     French would need the team's gender to pick the right
								     article. -->
								<p class="text-xs text-gray-400 sm:text-sm">{i18n.m.game.allIdentified(gender)}</p>
								<!-- No accuracy to report when there was nothing to guess (a
								     roster where nobody has a number starts complete). -->
								{#if game.guesses > 0}
									<p class="text-xs text-gray-400 sm:text-sm">
										{i18n.m.game.accuracy(i18n.percent(guessableCount / game.guesses))}
									</p>
								{/if}
								<button
									onclick={() => {
										game = initialState();
									}}
									class="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
								>
									{i18n.m.game.playAgain}
								</button>
							</div>
						{/if}
					</div>

					<!-- Guessed pile -->
					<div class="relative aspect-[3/4] w-full max-w-72 flex-1">
						<!-- The empty slot, visible until the first card lands. -->
						<div
							class="absolute inset-0 rounded-2xl border-2 border-dashed border-white/10"
							aria-hidden="true"
						></div>
						{#if game.previous}
							<!-- Underneath the top card, peeking out at an alternating
							     angle so the pile reads as a pile. -->
							<div
								class="absolute inset-0"
								style="rotate: {game.previous.key % 2 === 0 ? 2 : -2}deg;"
								aria-hidden="true"
							>
								<HockeyCard {team} player={game.previous.player} correct={game.previous.correct} />
							</div>
						{/if}
						{#if game.resolved}
							{#key game.resolved.key}
								<div class="card-fly absolute inset-0">
									<HockeyCard {team} player={game.resolved.player} correct={shownCorrect} />
								</div>
							{/key}
						{/if}
					</div>
				</div>

				<!-- The visual verdict is the card flip; this announces it to
				     screen readers. -->
				<p class="sr-only" role="status">
					{#if game.resolved}
						{game.resolved.correct ? i18n.m.card.correct : i18n.m.card.wrong}
						{game.resolved.player.firstName}
						{game.resolved.player.lastName}
					{/if}
				</p>

				<!-- Progress -->
				<p class="text-sm text-gray-400">
					{i18n.m.game.identified(game.identified.length, roster.length, gender)}
				</p>
			</div>

			<!-- Full Roster — desktop only -->
			<div class="hidden w-full max-w-lg lg:block">
				<h3 class="mb-3 text-center text-lg font-semibold text-gray-500">
					{i18n.m.game.roster}
				</h3>
				{@render rosterGroups()}
			</div>
		</div>

		<!-- Mobile bottom drawer; gone once the piles are empty and there is
		     nothing left to guess. -->
		{#if game.current}
			<div
				class="drawer fixed right-0 bottom-0 left-0 z-40 flex flex-col rounded-t-2xl border-t border-white/10 bg-gray-900 shadow-2xl lg:hidden"
				class:drawer--open={drawerOpen}
				style:max-height={drawerMax === null ? undefined : `${drawerMax}px`}
			>
				<!-- Handle / toggle -->
				<button
					onclick={() => (drawerOpen = !drawerOpen)}
					class="flex w-full shrink-0 flex-col items-center gap-1.5 px-4 pt-3 pb-2"
					aria-label={drawerOpen ? i18n.m.game.collapseRoster : i18n.m.game.expandRoster}
				>
					<div class="h-1 w-10 rounded-full bg-white/20"></div>
					<span class="text-xs text-gray-500">
						{drawerOpen ? `▼ ${i18n.m.game.hideRoster}` : `▲ ${i18n.m.game.showAll}`}
					</span>
				</button>

				{#if drawerOpen}
					<!-- Expanded: full roster, scrolling only once the drawer has
					     taken all the space below the cards -->
					<div class="min-h-0 overflow-y-auto px-4 pb-8">
						<p
							class="mb-3 text-center text-4xl font-black"
							style="color: {colors?.primary ?? '#fff'};"
						>
							#{game.current.player.sweaterNumber}
						</p>
						{@render rosterGroups()}
					</div>
				{:else}
					<!-- Collapsed: active options only -->
					<div class="min-h-0 overflow-y-auto px-4 pb-4" bind:this={optionsBox}>
						<div
							class="grid gap-1.5"
							style="grid-template-columns: repeat({optionColumns}, minmax(0, 1fr));"
						>
							{#each activeOptions as player (player.id)}
								<button
									onclick={() => guessPlayer(player.id)}
									class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95"
									style="border-color: {colors?.primary ?? '#555'}; background: {colors?.primary ??
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
	</main>
</div>

<style>
	/* A drawn card lifts off the stack into place. */
	.card-draw {
		animation: draw-in 200ms ease-out;
	}

	/* A guessed card flies from the deck — one zone-width plus the flex gap to
	   the left — while HockeyCard's own transition turns it over. */
	.card-fly {
		animation: fly-in 500ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes draw-in {
		from {
			transform: translate(6px, 6px);
			opacity: 0;
		}
	}

	@keyframes fly-in {
		from {
			transform: translateX(calc(-100% - 1rem));
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card-draw,
		.card-fly {
			animation: fade-in 300ms ease-out;
		}
	}
</style>
