<script lang="ts">
    import HockeyCard from "$lib/components/HockeyCard.svelte";
    import type { Player } from "$lib/server/db";
    import { TEAM_COLORS } from "$lib/team-colors";
    import { resolve } from "$app/paths";

    const { data } = $props();
    const { team, roster } = $derived(data);

    const colors = $derived(TEAM_COLORS[team.abbreviation]);

    const forwards = $derived(
        roster.filter((player) =>
            ["L", "C", "R"].includes(player.positionCode),
        ),
    );
    const defensemen = $derived(
        roster.filter((player) => player.positionCode === "D"),
    );
    const goalies = $derived(
        roster.filter((player) => player.positionCode === "G"),
    );
    const other = $derived(
        roster.filter(
            (player) =>
                !["L", "C", "R", "D", "G"].includes(player.positionCode),
        ),
    );

    const DIFFICULTY_KEY = "numbrrs_difficulty";
    const DIFFICULTY_OPTIONS = [
        { label: "Easy", value: 2 },
        { label: "Medium", value: 4 },
        { label: "Hard", value: 8 },
        { label: "Expert", value: Infinity },
    ] as const;
    let difficulty = $state(
        typeof localStorage !== "undefined"
            ? Number(localStorage.getItem(DIFFICULTY_KEY) ?? "2")
            : 2,
    );
    const AUTO_ADVANCE_KEY = "numbrrs_auto_advance";
    let autoAdvance = $state(
        typeof localStorage !== "undefined"
            ? (localStorage.getItem(AUTO_ADVANCE_KEY) ?? "true") !== "false"
            : true,
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

    // Explicit game state
    type Question = {
        player: Player;
        optionIds: number[];
    };

    type GameState =
        | {
              phase: "guessing";
              question: Question;
              correct: null;
              guesses: number;
              correctGuesses: number[];
          }
        | {
              phase: "revealed";
              question: Question;
              correct: boolean;
              guesses: number;
              correctGuesses: number[];
          };

    // Players without a sweater number can't be guessed by number, so they
    // start already-identified (shown green/unselectable with "--").
    function preIdentifiedIds(): number[] {
        return roster.filter((p) => p.sweaterNumber == null).map((p) => p.id);
    }
    const guessableCount = $derived(roster.length - preIdentifiedIds().length);

    let gameState = $state<GameState>({
        phase: "guessing",
        question: getNextQuestion(preIdentifiedIds()),
        correct: null,
        guesses: 0,
        correctGuesses: preIdentifiedIds(),
    });

    let activeOptions = $derived(
        roster.filter((player) =>
            gameState.question.optionIds.includes(player.id),
        ),
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
        if (gameState.phase !== "guessing") return;
        drawerOpen = false;
        gameState.guesses += 1;
        if (playerId === gameState.question.player.id) {
            gameState.correctGuesses.push(playerId);
            gameState = {
                ...gameState,
                phase: "revealed",
                correct: true,
            };
        } else {
            gameState = {
                ...gameState,
                phase: "revealed",
                correct: false,
            };
        }
        startAutoTimer();
    }

    function nextPlayer() {
        cancelAutoTimer();
        gameState = {
            ...gameState,
            phase: "guessing",
            correct: null,
        };
        flipTimer = setTimeout(() => {
            gameState = {
                ...gameState,
                phase: "guessing",
                correct: null,
                question: getNextQuestion(gameState.correctGuesses),
            };
        }, 300);
    }

    function getNextQuestion(correctGuesses: number[]): Question {
        const remaining = roster.filter((p) => !correctGuesses.includes(p.id));
        const player = remaining[Math.floor(Math.random() * remaining.length)];
        const others = remaining.filter((p) => p.id !== player.id);
        for (let i = others.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [others[i], others[j]] = [others[j], others[i]];
        }
        const numOptions = Math.min(difficulty, remaining.length);
        const optionIds = [
            player.id,
            ...others.slice(0, numOptions - 1).map((p) => p.id),
        ];
        for (let i = optionIds.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [optionIds[i], optionIds[j]] = [optionIds[j], optionIds[i]];
        }
        return { player, optionIds };
    }
</script>

<div class="min-h-screen bg-gray-900 text-white">
    <header class="flex items-center justify-between px-6 py-4">
        <a href={resolve("/")} class="text-sm text-gray-400 hover:text-white"
            >&larr; Back</a
        >
        <h1
            class="text-xl font-bold"
            style="color: {colors?.primary ?? '#fff'};"
        >
            {team.name}
        </h1>
        <div class="flex items-center gap-3">
            <select
                bind:value={difficulty}
                onchange={() => {
                    gameState = {
                        ...gameState,
                        phase: "guessing",
                        question: getNextQuestion(gameState.correctGuesses),
                        correct: null,
                    };
                }}
                class="rounded bg-white/10 px-2 py-1 text-xs text-gray-400"
            >
                {#each DIFFICULTY_OPTIONS as opt (opt.label)}
                    <option value={opt.value}>{opt.label}</option>
                {/each}
            </select>
            <label class="flex items-center gap-1.5 text-xs text-gray-400">
                <input
                    type="checkbox"
                    bind:checked={autoAdvance}
                    onchange={() => {
                        if (!autoAdvance) cancelAutoTimer();
                        else if (gameState.phase === "revealed")
                            startAutoTimer();
                    }}
                    class="rounded"
                />
                Auto-advance
            </label>
        </div>
    </header>

    <main class="mx-auto max-w-6xl px-4 pb-64 lg:pb-12">
        {#if gameState.correctGuesses.length === roster.length}
            <!-- Game complete -->
            <div class="mt-12 text-center">
                <h2 class="text-4xl font-bold text-green-400">
                    Congratulations!
                </h2>
                <p class="mt-2 text-gray-400">
                    You identified every player on the {team.name} roster!
                </p>
                <p class="mt-2 text-gray-400">
                    Accuracy: {Math.round(
                        (100 * guessableCount) / gameState.guesses,
                    )}%
                </p>
                <button
                    onclick={() => {
                        gameState = {
                            phase: "guessing",
                            question: getNextQuestion(preIdentifiedIds()),
                            correct: null,
                            guesses: 0,
                            correctGuesses: preIdentifiedIds(),
                        };
                    }}
                    class="mt-6 inline-block rounded-lg bg-white/10 px-6 py-3 font-semibold hover:bg-white/20"
                >
                    Play Again
                </button>
            </div>
        {:else}
            {#snippet playerGrid(group: typeof roster)}
                <div class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                    {#each group as player (player.id)}
                        {@const identified = gameState.correctGuesses.includes(
                            player.id,
                        )}
                        {@const selectable =
                            gameState.question.optionIds.includes(player.id)}
                        {#if identified}
                            <div
                                class="flex flex-row justify-between rounded-lg border border-green-800 bg-green-900/30 px-3 py-2 text-sm text-green-400"
                            >
                                <div>
                                    {player.firstName}
                                    {player.lastName}
                                </div>
                                {player.sweaterNumber ?? "--"}
                            </div>
                        {:else if selectable}
                            <button
                                onclick={() => guessPlayer(player.id)}
                                class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all hover:scale-105"
                                style="border-color: {colors?.primary ??
                                    '#555'}; background: {colors?.primary ??
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
                        <p
                            class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
                        >
                            Forwards
                        </p>
                        {@render playerGrid(forwards)}
                    </div>
                    <div>
                        <p
                            class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
                        >
                            Defense
                        </p>
                        {@render playerGrid(defensemen)}
                    </div>
                    <div>
                        <p
                            class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
                        >
                            Goalies
                        </p>
                        {@render playerGrid(goalies)}
                    </div>
                    {#if other.length > 0}
                        <div>
                            <p
                                class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500"
                            >
                                Other
                            </p>
                            {@render playerGrid(other)}
                        </div>
                    {/if}
                </div>
            {/snippet}

            <div
                class="flex flex-col items-center gap-8 lg:flex-row lg:items-start lg:justify-center"
            >
                <!-- Card -->
                <div class="flex flex-col items-center gap-4">
                    <HockeyCard
                        {team}
                        player={gameState.question.player}
                        correct={gameState.phase === "revealed"
                            ? gameState.correct
                            : null}
                    />

                    <!-- Progress -->
                    <p class="text-sm text-gray-400">
                        {gameState.correctGuesses.length} / {roster.length} identified
                    </p>

                    {#if gameState.phase === "revealed"}
                        <button
                            onclick={() => nextPlayer()}
                            class="next-btn relative overflow-hidden rounded-lg bg-white/10 px-8 py-3 font-semibold transition-colors hover:bg-white/20"
                        >
                            {#if timerRunning}
                                <span class="timer-bar"></span>
                            {/if}
                            Next Player &rarr;
                        </button>
                    {/if}
                </div>

                <!-- Full Roster — desktop only -->
                <div class="hidden w-full max-w-lg lg:block">
                    <h3
                        class="mb-3 text-center text-lg font-semibold text-gray-500"
                    >
                        Roster
                    </h3>
                    {@render rosterGroups()}
                </div>
            </div>

            <!-- Mobile bottom drawer -->
            <div
                class="drawer lg:hidden fixed bottom-0 left-0 right-0 z-40 rounded-t-2xl border-t border-white/10 bg-gray-900 shadow-2xl"
                class:drawer--open={drawerOpen}
            >
                <!-- Handle / toggle -->
                <button
                    onclick={() => (drawerOpen = !drawerOpen)}
                    class="flex w-full flex-col items-center gap-1.5 px-4 pb-2 pt-3"
                    aria-label={drawerOpen
                        ? "Collapse roster"
                        : "Expand roster"}
                >
                    <div class="h-1 w-10 rounded-full bg-white/20"></div>
                    <span class="text-xs text-gray-500">
                        {drawerOpen ? "▼ hide roster" : "▲ show all"}
                    </span>
                </button>

                {#if drawerOpen}
                    <!-- Expanded: full roster, scrollable -->
                    <div class="overflow-y-auto px-4 pb-8 drawer__full">
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
                    <div class="overflow-y-auto px-4 pb-4 drawer__options">
                        <div class="grid grid-cols-2 gap-1.5">
                            {#each activeOptions as player (player.id)}
                                <button
                                    onclick={() => guessPlayer(player.id)}
                                    class="w-full rounded-lg border-2 px-3 py-2 text-left text-sm font-semibold transition-all active:scale-95"
                                    style="border-color: {colors?.primary ??
                                        '#555'}; background: {colors?.primary ??
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
