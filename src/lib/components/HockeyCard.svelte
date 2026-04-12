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
    let lightGradient = $derived(
        colors?.lightGradient ?? [primaryColor, primaryColor],
    );
    let darkGradient = $derived(colors?.darkGradient ?? ["#1a1a2e", "#16213e"]);
    let teamName = $derived(team.name);
    let playerName = $derived(`${player.firstName} ${player.lastName}`);
    let sweaterNumber = $derived(player.sweaterNumber);
    let position = $derived(
        positionNames[player.positionCode] || player.positionCode,
    );
    let headshotUrl = $derived(player.headshotUrl);
    let flipped = $derived(correct !== null);
    let logoUrl = $derived(
        `https://assets.nhle.com/logos/nhl/svg/${team.abbreviation}_light.svg`,
    );
</script>

<div class="group w-72 h-96 bg-transparent perspective-midrange mx-auto">
    <div
        class="relative h-full w-full transition-transform duration-500 transform-3d data-[flipped=true]:rotate-y-180"
        data-flipped={flipped}
    >
        <section
            class="absolute inset-0 h-full w-full backface-hidden rounded-2xl border-2 shadow-2xl overflow-clip"
            style="border-color: {primaryColor}66; box-shadow: 0 0 24px 4px {primaryColor}33; background: linear-gradient(160deg, {lightGradient[0]}, {lightGradient[1]});"
        >
            <!-- Watermark logo -->
            <img src={logoUrl} alt="" aria-hidden="true" class="absolute inset-0 w-full h-full object-contain opacity-[0.07] pointer-events-none p-6 rounded-[inherit]" />

            <!-- Content -->
            <div
                class="relative flex h-full flex-col items-center justify-center p-6"
            >
                <span
                    class="font-condensed text-xs font-bold uppercase tracking-widest text-white/70"
                >
                    {teamName}
                </span>
                <span
                    class="font-condensed text-[clamp(5rem,20vw,7rem)] font-black text-white drop-shadow-lg leading-none mt-2"
                >
                    #{sweaterNumber}
                </span>
                <span
                    class="font-condensed mt-4 text-xs font-semibold uppercase tracking-widest text-white/50"
                >
                    Who wears this number?
                </span>
            </div>
        </section>
        <section
            class="absolute h-full w-full rotate-y-180 backface-hidden rounded-2xl border-2 shadow-2xl overflow-clip"
            style="border-color: {correct === true
                ? '#22c55e'
                : correct === false
                  ? '#ef4444'
                  : primaryColor}66; box-shadow: 0 0 24px 4px {correct === true
                ? '#22c55e'
                : correct === false
                  ? '#ef4444'
                  : primaryColor}33; background: linear-gradient(160deg, {darkGradient[0]}, {darkGradient[1]});"
        >
            <!-- Back -->
            <!-- Watermark logo -->
            <img src={logoUrl} alt="" aria-hidden="true" class="absolute inset-0 w-full h-full object-contain opacity-[0.07] pointer-events-none p-6 rounded-[inherit]" />

            <div
                class="relative flex h-full flex-col items-center justify-center gap-1 p-6"
            >
                {#if headshotUrl}
                    <img
                        src={headshotUrl}
                        alt={playerName}
                        class="h-28 w-28 rounded-full border-2 object-cover shadow-lg"
                        style="border-color: {primaryColor};"
                    />
                {/if}
                <span class="font-condensed mt-3 text-2xl font-bold text-white"
                    >{playerName}</span
                >
                <span
                    class="font-condensed text-4xl font-black"
                    style="color: {primaryColor};">#{sweaterNumber}</span
                >
                <span class="text-sm text-gray-400">{position}</span>
                {#if correct === true}
                    <span
                        class="mt-2 rounded-full bg-green-600 px-4 py-1 font-condensed text-sm font-bold text-white"
                    >
                        Correct!
                    </span>
                {:else if correct === false}
                    <span
                        class="mt-2 rounded-full bg-red-600 px-4 py-1 font-condensed text-sm font-bold text-white"
                    >
                        Wrong
                    </span>
                {/if}
            </div>
        </section>
    </div>
</div>
