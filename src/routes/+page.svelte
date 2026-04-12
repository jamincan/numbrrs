<script lang="ts">
    import { resolve } from "$app/paths";
    import { TEAM_COLORS } from "$lib/team-colors";

    let { data } = $props();
    let { teams } = $derived(data);
</script>

<div class="min-h-screen bg-gray-900 text-white">
    <header class="py-8 text-center">
        <h1 class="text-5xl font-bold tracking-tight">NumBrrs</h1>
        <p class="mt-2 text-lg text-gray-400">
            Learn NHL jersey numbers, one card at a time
        </p>
    </header>

    <main class="mx-auto max-w-5xl px-4 pb-12">
        <h2 class="mb-6 text-center text-2xl font-semibold">Choose a Team</h2>

        {#if teams.length === 0}
            <p class="text-center text-gray-400">
                Loading teams... Roster data is syncing from the NHL API.
                Refresh in a moment.
            </p>
        {:else}
            <div
                class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            >
                {#each teams as team}
                    {@const colors = TEAM_COLORS[team.abbreviation]}
                    <a
                        href={resolve("/game/[team]", {
                            team: team.abbreviation,
                        })}
                        class="group flex flex-col items-center rounded-xl border-2 p-4 transition-all hover:scale-105"
                        style="border-color: {colors?.primary ??
                            '#555'}; background: linear-gradient(160deg, {colors
                            ?.darkGradient[0] ?? '#1a1a2e'}, {colors
                            ?.darkGradient[1] ?? '#16213e'});"
                    >
                        <span
                            class="text-3xl font-black tracking-wider"
                            style="color: {colors?.primary ?? '#fff'};"
                        >
                            {team.abbreviation}
                        </span>
                        <span class="mt-1 text-center text-sm text-gray-300"
                            >{team.name}</span
                        >
                    </a>
                {/each}
            </div>
        {/if}
    </main>
</div>
