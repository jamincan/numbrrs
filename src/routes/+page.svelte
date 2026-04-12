<script lang="ts">
    import { resolve } from "$app/paths";
    import { TEAM_COLORS } from "$lib/team-colors";

    let { data } = $props();
    let { teams } = $derived(data);
</script>

<div class="min-h-screen bg-gray-950 text-white">
    <header class="py-10 text-center">
        <h1 class="font-condensed text-6xl font-black tracking-tight">Numbrrs</h1>
        <p class="mt-2 text-lg text-gray-400">
            Learn NHL jersey numbers, one card at a time
        </p>
    </header>

    <main class="mx-auto max-w-5xl px-4 pb-12">
        <h2 class="font-condensed mb-6 text-center text-2xl font-bold uppercase tracking-widest text-gray-400">Choose a Team</h2>

        {#if teams.length === 0}
            <p class="text-center text-gray-400">
                Loading teams... Roster data is syncing from the NHL API.
                Refresh in a moment.
            </p>
        {:else}
            <div
                class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
            >
                {#each teams as team}
                    {@const colors = TEAM_COLORS[team.abbreviation]}
                    {@const primary = colors?.primary ?? '#555'}
                    <a
                        href={resolve("/game/[team]", { team: team.abbreviation })}
                        class="group flex flex-col items-center gap-2 rounded-xl border p-4 transition-all duration-200 hover:scale-105"
                        style="border-color: {primary}44; background: linear-gradient(160deg, {colors?.darkGradient[0] ?? '#1a1a2e'}, {colors?.darkGradient[1] ?? '#16213e'}); box-shadow: 0 0 0 0 {primary}; transition: box-shadow 0.2s;"
                        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px 2px ${primary}44`}
                        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.boxShadow = 'none'}
                    >
                        <img
                            src="https://assets.nhle.com/logos/nhl/svg/{team.abbreviation}_light.svg"
                            alt={team.name}
                            class="h-14 w-14 object-contain drop-shadow-lg"
                        />
                        <span class="font-condensed text-center text-sm font-bold uppercase tracking-wide text-gray-300">
                            {team.name}
                        </span>
                    </a>
                {/each}
            </div>
        {/if}
    </main>
</div>
