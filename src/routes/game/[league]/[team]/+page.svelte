<script lang="ts">
	import { resolve } from '$app/paths';
	import { getTeamColors } from '$lib/team-colors';
	import RosterGame from './RosterGame.svelte';

	const { data } = $props();
	const { team } = $derived(data);

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
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
			<a href={resolve('/')} class="text-sm text-gray-400 hover:text-white">&larr; Back</a>
			<h1 class="text-xl font-bold" style="color: {colors?.primary ?? '#fff'};">
				{team.name}
			</h1>
			<div class="w-12"></div>
		</header>
		<main class="mx-auto max-w-6xl px-4 py-24 text-center">
			<div
				class="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10"
				style="border-top-color: {colors?.primary ?? '#fff'};"
			></div>
			<p class="mt-6 text-sm tracking-widest text-gray-400 uppercase">Loading roster</p>
		</main>
	</div>
{:then roster}
	{#if roster.length === 0}
		<div class="min-h-screen bg-gray-900 text-white">
			<header class="flex items-center justify-between px-6 py-4">
				<a href={resolve('/')} class="text-sm text-gray-400 hover:text-white">&larr; Back</a>
				<h1 class="text-xl font-bold" style="color: {colors?.primary ?? '#fff'};">
					{team.name}
				</h1>
				<div class="w-12"></div>
			</header>
			<main class="mx-auto max-w-6xl px-4 py-24 text-center">
				<p class="text-gray-400">
					No roster available for the {team.name} right now. Refresh in a moment.
				</p>
			</main>
		</div>
	{:else}
		<RosterGame {team} {roster} />
	{/if}
{/await}
