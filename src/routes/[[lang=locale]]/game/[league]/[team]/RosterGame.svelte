<script lang="ts">
	import { browser } from '$app/environment';
	import HockeyCard from '$lib/components/HockeyCard.svelte';
	import GameHeader from './GameHeader.svelte';
	import type { Player, Team } from '$lib/types';
	import { nextQuestion, preIdentifiedIds, type Question } from '$lib/game';
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
	const AUTO_ADVANCE_KEY = 'numbrrs_auto_advance';
	let autoAdvance = $state(
		browser ? (localStorage.getItem(AUTO_ADVANCE_KEY) ?? 'true') !== 'false' : true
	);

	$effect(() => {
		localStorage.setItem(AUTO_ADVANCE_KEY, String(autoAdvance));
		localStorage.setItem(DIFFICULTY_KEY, String(difficulty));
	});

	let autoTimer: ReturnType<typeof setTimeout> | null = $state(null);
	let flipTimer: ReturnType<typeof setTimeout> | null = $state(null);
	let timerRunning = $state(false);

	$effect(() => {
		return () => {
			if (flipTimer) {
				clearTimeout(flipTimer);
			}
			if (autoTimer) {
				clearTimeout(autoTimer);
			}
		};
	});

	let drawerOpen = $state(false);

	// Explicit game state; every transition replaces the object rather than
	// mutating it, so the discriminated union actually guarantees what it says.
	type GameState =
		| {
				phase: 'complete';
				guesses: number;
				correctGuesses: number[];
		  }
		| {
				phase: 'guessing';
				question: Question<Player>;
				correct: null;
				guesses: number;
				correctGuesses: number[];
		  }
		// The moment between questions while the card flips back. Guesses are
		// ignored here so a quick tap can't land on the outgoing question and be
		// silently clobbered when the new one arrives.
		| {
				phase: 'advancing';
				question: Question<Player>;
				correct: null;
				guesses: number;
				correctGuesses: number[];
		  }
		| {
				phase: 'revealed';
				question: Question<Player>;
				correct: boolean;
				guesses: number;
				correctGuesses: number[];
		  };

	const guessableCount = $derived(roster.length - preIdentifiedIds(roster).length);

	/**
	 * A fresh game: nothing guessed yet beyond the numberless players. A roster
	 * where nobody has a number starts (and stays) complete instead of crashing
	 * on a question that can't be built.
	 */
	function initialState(): GameState {
		const correctGuesses = preIdentifiedIds(roster);
		const question = nextQuestion(roster, correctGuesses, difficulty);
		if (!question) return { phase: 'complete', guesses: 0, correctGuesses };
		return { phase: 'guessing', question, correct: null, guesses: 0, correctGuesses };
	}

	let gameState = $state<GameState>(initialState());

	// In the shuffled order the question chose — deriving this by filtering the
	// roster would quietly re-impose roster order instead.
	let activeOptions = $derived(
		gameState.phase === 'complete'
			? []
			: gameState.question.optionIds.flatMap((id) => roster.find((p) => p.id === id) ?? [])
	);

	/// start a timer that will call nextPlayer after 1.5s provided autoAdvance is set
	function startAutoTimer() {
		cancelAutoTimer();
		if (!autoAdvance) return;
		timerRunning = true;
		autoTimer = setTimeout(() => {
			timerRunning = false;
			nextPlayer();
		}, 1500);
	}

	function cancelAutoTimer() {
		if (autoTimer) {
			clearTimeout(autoTimer);
			autoTimer = null;
		}
		timerRunning = false;
	}

	function guessPlayer(playerId: number) {
		if (gameState.phase !== 'guessing') return;
		drawerOpen = false;
		const { question, guesses, correctGuesses } = gameState;
		const guessed = roster.find((p) => p.id === playerId);
		const answer = question.player.sweaterNumber;
		// Teams regularly carry two players on one number over a season — someone
		// departs and their replacement takes the sweater. The card only shows a
		// number, so every player wearing it is a right answer; picking the one the
		// question wasn't built from isn't a mistake. Only the player actually
		// picked is identified though, so the other still has to be found later.
		if (guessed && answer != null && guessed.sweaterNumber === answer) {
			const identified = [...correctGuesses, guessed.id];
			if (identified.length === roster.length) {
				// That was the last player: straight to the summary, with no
				// auto-advance timer left running toward a question that can't exist.
				gameState = { phase: 'complete', guesses: guesses + 1, correctGuesses: identified };
				return;
			}
			gameState = {
				phase: 'revealed',
				correct: true,
				guesses: guesses + 1,
				correctGuesses: identified,
				// Reveal whoever was picked, not whichever player the question
				// happened to be built from — showing the other one reads as a
				// correction when the answer was accepted.
				question: { ...question, player: guessed }
			};
		} else {
			gameState = {
				phase: 'revealed',
				correct: false,
				guesses: guesses + 1,
				correctGuesses,
				question
			};
		}
		startAutoTimer();
	}

	function nextPlayer() {
		if (gameState.phase !== 'revealed') return;
		cancelAutoTimer();
		// Flip the card back first; the new question arrives once the flip is
		// under way, so the next answer isn't briefly visible mid-flip.
		gameState = { ...gameState, phase: 'advancing', correct: null };
		flipTimer = setTimeout(() => {
			if (gameState.phase !== 'advancing') return;
			const question = nextQuestion(roster, gameState.correctGuesses, difficulty);
			if (question) {
				gameState = { ...gameState, phase: 'guessing', correct: null, question };
			}
		}, 300);
	}
</script>

<div class="min-h-screen bg-gray-900 text-white">
	<GameHeader {name} color={colors?.primary}>
		<div class="flex items-center gap-3">
			<select
				bind:value={difficulty}
				aria-label={i18n.m.game.difficultyLabel}
				onchange={() => {
					cancelAutoTimer();
					if (gameState.phase === 'complete') return;
					const question = nextQuestion(roster, gameState.correctGuesses, difficulty);
					if (question) {
						gameState = { ...gameState, phase: 'guessing', correct: null, question };
					}
				}}
				class="rounded bg-white/10 px-2 py-1 text-xs text-gray-400"
			>
				{#each DIFFICULTY_OPTIONS as opt (opt.key)}
					<option value={opt.value}>{i18n.m.game.difficulty[opt.key]}</option>
				{/each}
			</select>
			<label class="flex items-center gap-1.5 text-xs text-gray-400">
				<input
					type="checkbox"
					bind:checked={autoAdvance}
					onchange={() => {
						if (!autoAdvance) cancelAutoTimer();
						else if (gameState.phase === 'revealed') startAutoTimer();
					}}
					class="rounded"
				/>
				{i18n.m.game.autoAdvance}
			</label>
		</div>
	</GameHeader>

	<main class="mx-auto max-w-6xl px-4 pb-64 lg:pb-12">
		{#if gameState.phase === 'complete'}
			<!-- Game complete -->
			<div class="mt-12 text-center">
				<h2 class="text-4xl font-bold text-green-400">{i18n.m.game.congratulations}</h2>
				<!-- The team name is in the header rather than this sentence: French
				     would need the team's gender to pick the right article. -->
				<p class="mt-2 text-gray-400">{i18n.m.game.allIdentified(gender)}</p>
				<!-- No accuracy to report when there was nothing to guess (a roster
				     where nobody has a number starts complete). -->
				{#if gameState.guesses > 0}
					<p class="mt-2 text-gray-400">
						{i18n.m.game.accuracy(i18n.percent(guessableCount / gameState.guesses))}
					</p>
				{/if}
				<button
					onclick={() => {
						gameState = initialState();
					}}
					class="mt-6 inline-block rounded-lg bg-white/10 px-6 py-3 font-semibold hover:bg-white/20"
				>
					{i18n.m.game.playAgain}
				</button>
			</div>
		{:else}
			{#snippet playerGrid(group: typeof roster)}
				<div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
					{#each group as player (player.id)}
						{@const identified = gameState.correctGuesses.includes(player.id)}
						{@const selectable =
							gameState.phase !== 'complete' && gameState.question.optionIds.includes(player.id)}
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
				<!-- Card -->
				<div class="flex flex-col items-center gap-4">
					<HockeyCard
						{team}
						player={gameState.question.player}
						correct={gameState.phase === 'revealed' ? gameState.correct : null}
					/>

					<!-- The visual verdict is the card flip; this announces it to
					     screen readers. -->
					<p class="sr-only" role="status">
						{#if gameState.phase === 'revealed'}
							{gameState.correct ? i18n.m.card.correct : i18n.m.card.wrong}
							{gameState.question.player.firstName}
							{gameState.question.player.lastName}
						{/if}
					</p>

					<!-- Progress -->
					<p class="text-sm text-gray-400">
						{i18n.m.game.identified(gameState.correctGuesses.length, roster.length, gender)}
					</p>

					{#if gameState.phase === 'revealed'}
						<button
							onclick={() => nextPlayer()}
							class="next-btn relative overflow-hidden rounded-lg bg-white/10 px-8 py-3 font-semibold transition-colors hover:bg-white/20"
						>
							{#if timerRunning}
								<span class="timer-bar"></span>
							{/if}
							{i18n.m.game.nextPlayer(gender)} &rarr;
						</button>
					{/if}
				</div>

				<!-- Full Roster — desktop only -->
				<div class="hidden w-full max-w-lg lg:block">
					<h3 class="mb-3 text-center text-lg font-semibold text-gray-500">
						{i18n.m.game.roster}
					</h3>
					{@render rosterGroups()}
				</div>
			</div>

			<!-- Mobile bottom drawer -->
			<div
				class="drawer fixed right-0 bottom-0 left-0 z-40 rounded-t-2xl border-t border-white/10 bg-gray-900 shadow-2xl lg:hidden"
				class:drawer--open={drawerOpen}
			>
				<!-- Handle / toggle -->
				<button
					onclick={() => (drawerOpen = !drawerOpen)}
					class="flex w-full flex-col items-center gap-1.5 px-4 pt-3 pb-2"
					aria-label={drawerOpen ? i18n.m.game.collapseRoster : i18n.m.game.expandRoster}
				>
					<div class="h-1 w-10 rounded-full bg-white/20"></div>
					<span class="text-xs text-gray-500">
						{drawerOpen ? `▼ ${i18n.m.game.hideRoster}` : `▲ ${i18n.m.game.showAll}`}
					</span>
				</button>

				{#if drawerOpen}
					<!-- Expanded: full roster, scrollable -->
					<div class="drawer__full overflow-y-auto px-4 pb-8">
						<p
							class="mb-3 text-center text-4xl font-black"
							style="color: {colors?.primary ?? '#fff'};"
						>
							#{gameState.question.player.sweaterNumber}
						</p>
						{@render rosterGroups()}
					</div>
				{:else}
					<!-- Collapsed: active options only -->
					<div class="drawer__options overflow-y-auto px-4 pb-4">
						<div class="grid grid-cols-2 gap-1.5">
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
	.next-btn {
		position: relative;
	}

	.timer-bar {
		position: absolute;
		bottom: 0;
		left: 0;
		height: 3px;
		background: white;
		opacity: 0.6;
		animation: shrink 1.5s linear forwards;
	}

	@keyframes shrink {
		from {
			width: 100%;
		}
		to {
			width: 0%;
		}
	}

	.drawer__options {
		max-height: 45vw;
	}

	.drawer__full {
		max-height: 65vh;
	}
</style>
