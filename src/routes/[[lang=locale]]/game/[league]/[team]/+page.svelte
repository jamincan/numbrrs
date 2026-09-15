<script lang="ts">
	import { invalidate } from '$app/navigation';
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

	/**
	 * How long to wait before each re-check of an empty roster. An empty roster
	 * usually means the league sync outran the page's timeout and is still
	 * finishing, so the first checks come quickly; the later ones cover a league
	 * that's backing off after a failure. About two minutes in total, after which
	 * the roster probably isn't coming and the visitor gets a button instead.
	 */
	const RETRY_DELAYS = [3000, 5000, 10_000, 15_000, 30_000, 60_000];

	// Keyed by team, so moving to another team starts with a full set of retries
	// rather than inheriting a spent one.
	let retries = $state({ teamId: '', count: 0 });
	const retryCount = $derived(retries.teamId === team.id ? retries.count : 0);

	function retry(count: number) {
		retries = { teamId: team.id, count };
		invalidate('app:roster');
	}

	/** Schedules the next re-check for as long as the waiting spinner is on screen. */
	function scheduleRetry(delay: number, count: number) {
		return () => {
			const timer = setTimeout(() => retry(count), delay);
			return () => clearTimeout(timer);
		};
	}
</script>

<svelte:head>
	<!-- The team pages are the site's long-tail search surface, so each one
	     titles and describes itself instead of inheriting a generic tag. -->
	<title>{name} – Numbrrs</title>
	<meta name="description" content={i18n.m.game.description(name)} />
	<meta property="og:title" content="{name} – Numbrrs" />
	<meta property="og:description" content={i18n.m.game.description(name)} />
</svelte:head>

{#snippet spinner()}
	<div
		class="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-white/10"
		style="border-top-color: {colors?.primary ?? '#fff'};"
	></div>
	<p class="mt-6 text-sm tracking-widest text-gray-400 uppercase">
		{i18n.m.game.loadingRoster}
	</p>
{/snippet}

<!--
	The team comes from the database and renders straight away; the roster is a
	promise the server streams in. A roster that's gone stale is refreshed from
	the league before it resolves, so the game starts on current data rather than
	swapping players out from under whoever's already playing.
-->
{#await data.roster}
	<div class="flex-1 bg-gray-900 text-white">
		<GameHeader {name} color={colors?.primary} />
		<main class="mx-auto max-w-6xl px-4 py-24 text-center">
			{@render spinner()}
		</main>
	</div>
{:then roster}
	{#if roster.length === 0}
		<div class="flex-1 bg-gray-900 text-white">
			<GameHeader {name} color={colors?.primary} />
			<main class="mx-auto max-w-6xl px-4 py-24 text-center">
				{#if retryCount < RETRY_DELAYS.length}
					<!-- Looks the same as the initial load on purpose: to the visitor it
					     is still the same wait. -->
					<div {@attach scheduleRetry(RETRY_DELAYS[retryCount] ?? 0, retryCount + 1)}>
						{@render spinner()}
					</div>
				{:else}
					<!-- The team name is already in the heading above, so this doesn't
					     repeat it: French would need the team's gender to pick the right
					     article ("du Drakkar", "des Canadiens"). -->
					<p class="text-gray-400">{i18n.m.game.noRoster}</p>
					<button
						type="button"
						class="mt-6 rounded-full border border-white/20 px-5 py-2 text-sm tracking-widest text-white uppercase hover:bg-white/10"
						onclick={() => retry(0)}
					>
						{i18n.m.game.retryRoster}
					</button>
				{/if}
			</main>
		</div>
	{:else}
		<RosterGame {team} {roster} />
	{/if}
{/await}
