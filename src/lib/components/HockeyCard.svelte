<script lang="ts">
    import type { Player, Team } from "$lib/server/db";
    import { TEAM_COLORS } from "$lib/team-colors";

    const positionNames: Record<string, string> = {
        C: "Center",
        L: "Left Wing",
        R: "Right Wing",
        D: "Defenseman",
        G: "Goalie",
    };

    type Props = {
        player: Player;
        team: Team;
        correct?: boolean | null;
    };

    let { player, team, correct = null }: Props = $props();

    let colors = $derived(TEAM_COLORS[team.abbreviation]);
    let primaryColor = $derived(colors?.primary ?? "#555555");
    let lightGradient = $derived(colors?.lightGradient ?? [primaryColor, primaryColor]);
    let darkGradient = $derived(colors?.darkGradient ?? ["#1a1a2e", "#16213e"]);
    let teamName = $derived(team.name);
    let playerName = $derived(`${player.firstName} ${player.lastName}`);
    let sweaterNumber = $derived(player.sweaterNumber);
    let position = $derived(
        positionNames[player.positionCode] || player.positionCode,
    );
    let headshotUrl = $derived(player.headshotUrl);
    let flipped = $derived(correct !== null);
</script>

<div class="card-container mx-auto" class:flipped>
    <div class="card">
        <!-- Front -->
        <div
            class="card-face card-front flex flex-col items-center justify-center rounded-2xl border-4 p-6 shadow-2xl"
            style="border-color: {primaryColor}; background: linear-gradient(160deg, {lightGradient[0]}, {lightGradient[1]});"
        >
            <span
                class="text-sm font-semibold uppercase tracking-widest text-white/80"
                >{teamName}</span
            >
            <span class="mt-2 text-8xl font-black text-white drop-shadow-lg"
                >#{sweaterNumber}</span
            >
            <span class="mt-3 text-xs uppercase tracking-wider text-white/60"
                >Who wears this number?</span
            >
        </div>

        <!-- Back -->
        <div
            class="card-face card-back flex flex-col items-center justify-center rounded-2xl border-4 p-6 shadow-2xl"
            style="border-color: {correct === true
                ? '#22c55e'
                : correct === false
                  ? '#ef4444'
                  : primaryColor}; background: linear-gradient(160deg, {darkGradient[0]}, {darkGradient[1]});"
        >
            {#if headshotUrl}
                <img
                    src={headshotUrl}
                    alt={playerName}
                    class="h-28 w-28 rounded-full border-2 object-cover"
                    style="border-color: {primaryColor};"
                />
            {/if}
            <span class="mt-3 text-2xl font-bold text-white">{playerName}</span>
            <span class="text-4xl font-black text-white/60"
                >#{sweaterNumber}</span
            >
            <span class="mt-1 text-sm text-gray-400">{position}</span>
            {#if correct === true}
                <span
                    class="mt-2 rounded-full bg-green-600 px-4 py-1 text-sm font-bold text-white"
                    >Correct!</span
                >
            {:else if correct === false}
                <span
                    class="mt-2 rounded-full bg-red-600 px-4 py-1 text-sm font-bold text-white"
                    >Wrong</span
                >
            {/if}
        </div>
    </div>
</div>

<style>
    .card-container {
        perspective: 1000px;
        width: 280px;
        height: 380px;
    }

    .card {
        position: relative;
        width: 100%;
        height: 100%;
        transition: transform 0.6s;
        transform-style: preserve-3d;
    }

    .flipped .card {
        transform: rotateY(180deg);
    }

    .card-face {
        position: absolute;
        inset: 0;
        backface-visibility: hidden;
    }

    .card-back {
        transform: rotateY(180deg);
    }
</style>
