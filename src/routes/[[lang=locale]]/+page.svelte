<script lang="ts">
	import { resolve } from '$app/paths';
	import { rememberCookie } from '$lib/cookies';
	import { getI18n } from '$lib/i18n/state.svelte';
	import { LEAGUES, LEAGUE_COOKIE, LEAGUE_MAX_AGE, type LeagueId } from '$lib/leagues';
	import { teamLogo } from '$lib/logos';
	import { getTeamColors } from '$lib/team-colors';
	import { teamName } from '$lib/team-names';

	const i18n = getI18n();

	let { data } = $props();
	let { teams } = $derived(data);

	// The remembered league arrives from the server (cookie-resolved), so the
	// grid is in the SSR payload — links and all — with no flash of the wrong
	// tab. After that the choice lives here, written back to the cookie for the
	// next visit.
	function initialLeague(): LeagueId {
		return data.initialLeague;
	}
	let league = $state<LeagueId>(initialLeague());

	function chooseLeague(id: LeagueId) {
		league = id;
		rememberCookie(LEAGUE_COOKIE, id, LEAGUE_MAX_AGE);
	}

	const leagueTeams = $derived(teams.filter((t) => t.league === league));
</script>

<svelte:head>
	<title>{i18n.m.title}</title>
	<meta name="description" content={i18n.m.description} />
	<meta property="og:title" content={i18n.m.title} />
	<meta property="og:description" content={i18n.m.description} />
</svelte:head>

<div class="min-h-screen bg-gray-950 text-white">
	<header class="py-10 text-center">
		<h1 class="font-condensed text-6xl font-black tracking-tight">Numbrrs</h1>
		<p class="mt-2 text-lg text-gray-400">{i18n.m.tagline}</p>
	</header>

	<main class="mx-auto max-w-5xl px-4 pb-12">
		<div class="mb-6 flex justify-center">
			<div
				class="flex flex-wrap justify-center rounded-lg border border-white/10 bg-white/5 p-1"
				role="tablist"
				aria-label={i18n.m.home.league}
			>
				{#each LEAGUES as option (option.id)}
					<button
						role="tab"
						aria-selected={league === option.id}
						onclick={() => chooseLeague(option.id)}
						class="font-condensed rounded-md px-3 py-1.5 text-sm font-bold tracking-widest uppercase transition-colors sm:px-5 {league ===
						option.id
							? 'bg-white/15 text-white'
							: 'text-gray-500 hover:text-gray-300'}"
					>
						{option.label[i18n.locale]}
					</button>
				{/each}
			</div>
		</div>

		<h2
			class="font-condensed mb-6 text-center text-2xl font-bold tracking-widest text-gray-400 uppercase"
		>
			{i18n.m.home.chooseTeam}
		</h2>

		{#if leagueTeams.length === 0}
			<!-- The team list is synced before this page renders, but that wait is
			     capped, so a league can still be filling in server-side. -->
			<p class="text-center text-gray-400">{i18n.m.home.teamsSyncing}</p>
		{:else}
			<!-- Opening a team syncs its roster, so preload on tap rather than the
			     app-wide hover: sweeping the cursor over the grid would otherwise
			     kick off a fetch for every tile the pointer crossed. -->
			<div
				class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
				data-sveltekit-preload-data="tap"
			>
				{#each leagueTeams as team (team.id)}
					{@const colors = getTeamColors(team.league, team.abbreviation)}
					{@const primary = colors?.primary ?? '#555'}
					{@const logo = teamLogo(team.league, team.abbreviation, team.logoUrl)}
					{@const name = teamName(i18n.locale, team)}
					<a
						href={resolve('/[[lang=locale]]/game/[league]/[team]', {
							lang: i18n.lang,
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
							src={logo.url}
							alt={name}
							class="h-14 w-14 object-contain drop-shadow-lg {logo.opaque
								? 'rounded-lg bg-white/95 p-1'
								: ''}"
						/>
						<span
							class="font-condensed text-center text-sm font-bold tracking-wide text-gray-300 uppercase"
						>
							{name}
						</span>
					</a>
				{/each}
			</div>
		{/if}
	</main>
</div>
