<script lang="ts">
	import { getI18n } from '$lib/i18n/state.svelte';
	import { getTeamColors } from '$lib/team-colors';
	import { teamName } from '$lib/team-names';
	import GameHeader from './GameHeader.svelte';
	import RosterGame from './RosterGame.svelte';

	const i18n = getI18n();

	const { data } = $props();
	const { team } = $derived(data);

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
	const name = $derived(teamName(i18n.locale, team));
</script>

<svelte:head>
	<!-- The team pages are the site's long-tail search surface, so each one
	     titles and describes itself instead of inheriting a generic tag. -->
	<title>{name} – Numbrrs</title>
	<meta name="description" content={i18n.m.game.description(name)} />
	<meta property="og:title" content="{name} – Numbrrs" />
	<meta property="og:description" content={i18n.m.game.description(name)} />
</svelte:head>

<!--
	The team comes from the database and renders straight away; the roster is a
	promise the server streams in. A roster that's gone stale is refreshed from
	the league before it resolves, so the game starts on current data rather than
	swapping players out from under whoever's already playing.
-->
{#await data.roster}
	<div class="min-h-screen bg-gray-900 text-white">
		<GameHeader {name} color={colors?.primary} />
		<main class="mx-auto max-w-6xl px-4 py-24 text-center">
			<div
				class="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10"
				style="border-top-color: {colors?.primary ?? '#fff'};"
			></div>
			<p class="mt-6 text-sm tracking-widest text-gray-400 uppercase">
				{i18n.m.game.loadingRoster}
			</p>
		</main>
	</div>
{:then roster}
	{#if roster.length === 0}
		<div class="min-h-screen bg-gray-900 text-white">
			<GameHeader {name} color={colors?.primary} />
			<main class="mx-auto max-w-6xl px-4 py-24 text-center">
				<!-- The team name is already in the heading above, so this doesn't
				     repeat it: French would need the team's gender to pick the right
				     article ("du Drakkar", "des Canadiens"). -->
				<p class="text-gray-400">{i18n.m.game.noRoster}</p>
			</main>
		</div>
	{:else}
		<RosterGame {team} {roster} />
	{/if}
{/await}
