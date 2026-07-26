<script lang="ts">
	import { getI18n } from '$lib/i18n/state.svelte';
	import { getTeamColors } from '$lib/team-colors';
	import { teamName } from '$lib/team-names';
	import RosterGame from './RosterGame.svelte';

	const i18n = getI18n();

	const { data } = $props();
	const { team } = $derived(data);

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
	const name = $derived(teamName(i18n.locale, team));
</script>

<!--
	The team comes from the database and renders straight away; the roster is a
	promise the server streams in. A roster that's gone stale is refreshed from
	the league before it resolves, so the game starts on current data rather than
	swapping players out from under whoever's already playing.
-->
{#await data.roster}
	<div class="min-h-screen bg-gray-900 text-white">
		<header class="flex items-center justify-between px-6 py-4">
			<a href={i18n.href('/')} class="text-sm text-gray-400 hover:text-white"
				>&larr; {i18n.m.game.back}</a
			>
			<h1 class="text-xl font-bold" style="color: {colors?.primary ?? '#fff'};">
				{name}
			</h1>
			<div class="w-12"></div>
		</header>
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
			<header class="flex items-center justify-between px-6 py-4">
				<a href={i18n.href('/')} class="text-sm text-gray-400 hover:text-white"
					>&larr; {i18n.m.game.back}</a
				>
				<h1 class="text-xl font-bold" style="color: {colors?.primary ?? '#fff'};">
					{name}
				</h1>
				<div class="w-12"></div>
			</header>
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
