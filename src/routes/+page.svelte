<script lang="ts">
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { LEAGUES, type LeagueId } from '$lib/leagues';
	import { getTeamColors } from '$lib/team-colors';

	let { data } = $props();
	let { teams } = $derived(data);

	const LEAGUE_KEY = 'numbrrs_league';

	function savedLeague(): LeagueId {
		const stored = localStorage.getItem(LEAGUE_KEY);
		return LEAGUES.some((l) => l.id === stored) ? (stored as LeagueId) : 'nhl';
	}

	// localStorage is only readable on the client, so the grid isn't
	// server-rendered: league stays null during SSR and is read synchronously
	// during client-side init, so the first client render already shows the
	// remembered league (no flash of the wrong one).
	let league = $state<LeagueId | null>(browser ? savedLeague() : null);

	$effect(() => {
		if (league) localStorage.setItem(LEAGUE_KEY, league);
	});

	const leagueTeams = $derived(teams.filter((t) => t.league === league));
</script>

<div class="min-h-screen bg-gray-950 text-white">
	<header class="py-10 text-center">
		<h1 class="font-condensed text-6xl font-black tracking-tight">Numbrrs</h1>
		<p class="mt-2 text-lg text-gray-400">Learn hockey jersey numbers, one card at a time</p>
	</header>

	<main class="mx-auto max-w-5xl px-4 pb-12">
		<div class="mb-6 flex justify-center">
			<div
				class="flex flex-wrap justify-center rounded-lg border border-white/10 bg-white/5 p-1"
				role="tablist"
				aria-label="League"
			>
				{#each LEAGUES as option (option.id)}
					<button
						role="tab"
						aria-selected={league === option.id}
						onclick={() => (league = option.id)}
						class="font-condensed rounded-md px-3 py-1.5 text-sm font-bold tracking-widest uppercase transition-colors sm:px-5 {league ===
						option.id
							? 'bg-white/15 text-white'
							: 'text-gray-500 hover:text-gray-300'}"
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>

		<h2
			class="font-condensed mb-6 text-center text-2xl font-bold tracking-widest text-gray-400 uppercase"
		>
			Choose a Team
		</h2>

		{#if league === null}
			<!-- SSR / pre-hydration placeholder; replaced as soon as the
                 remembered league is read from localStorage on the client. -->
			<p class="text-center text-gray-400">Loading teams...</p>
		{:else if leagueTeams.length === 0}
			<p class="text-center text-gray-400">
				Loading teams... Roster data is syncing from the league API. Refresh in a moment.
			</p>
		{:else}
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each leagueTeams as team (team.id)}
					{@const colors = getTeamColors(team.league, team.abbreviation)}
					{@const primary = colors?.primary ?? '#555'}
					<a
						href={resolve('/game/[league]/[team]', {
							league: team.league,
							team: team.abbreviation
						})}
						class="group flex flex-col items-center gap-2 rounded-xl border p-4 transition-all duration-200 hover:scale-105"
						style="border-color: {primary}44; background: linear-gradient(160deg, {colors
							?.darkGradient[0] ?? '#1a1a2e'}, {colors?.darkGradient[1] ??
							'#16213e'}); box-shadow: 0 0 0 0 {primary}; transition: box-shadow 0.2s;"
						onmouseenter={(e) =>
							((e.currentTarget as HTMLElement).style.boxShadow = `0 0 16px 2px ${primary}44`)}
						onmouseleave={(e) => ((e.currentTarget as HTMLElement).style.boxShadow = 'none')}
					>
						<img
							src={team.logoUrl}
							alt={team.name}
							class="h-14 w-14 object-contain drop-shadow-lg"
						/>
						<span
							class="font-condensed text-center text-sm font-bold tracking-wide text-gray-300 uppercase"
						>
							{team.name}
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</main>
</div>
