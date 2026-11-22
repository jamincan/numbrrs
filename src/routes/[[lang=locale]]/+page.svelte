<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { rememberCookie } from '#lib/cookies.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import {
		LEAGUES,
		LEAGUE_COOKIE,
		LEAGUE_MAX_AGE,
		LEAGUE_PARAM,
		leagueGender,
		type LeagueId
	} from '#lib/leagues.ts';
	import Medal from '#lib/components/Medal.svelte';
	import Trophy from '#lib/components/Trophy.svelte';
	import { levelForMedal, type Medal as MedalKind } from '#lib/game.ts';
	import { teamLogo } from '#lib/logos.ts';
	import { RecordBook } from '#lib/records.svelte.ts';
	import { getTeamColors } from '#lib/team-colors.ts';
	import { teamName } from '#lib/team-names.ts';
	import { trophiesHeld } from '#lib/trophies.ts';

	const i18n = getI18n();

	let { data } = $props();
	let { teams, marks } = $derived(data);

	// The league to show arrives from the server (the URL's, else the cookie's),
	// so the grid is in the SSR payload — links and all — with no flash of the
	// wrong tab. After that a tab click sets it here; it follows the server
	// again whenever the page's data is loaded afresh.
	let league = $derived(data.initialLeague);

	const home = $derived(resolve('/[[lang=locale]]', { lang: i18n.lang }));

	/**
	 * Each tab is a link, and that is all it is without JavaScript: the server
	 * renders whichever league the URL names. With it, every league's teams are
	 * already on the page, so a plain click swaps the grid in place and writes
	 * the choice to the cookie for the next visit, and the link is never
	 * followed.
	 */
	function chooseLeague(event: MouseEvent, id: LeagueId) {
		// A click that asks for a new tab or window is asking for the link.
		if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
			return;
		}
		event.preventDefault();

		league = id;
		rememberCookie(LEAGUE_COOKIE, id, LEAGUE_MAX_AGE);

		// A league named in the address outranks the cookie, so left there it
		// would bring the old tab back on a reload, and the language toggle would
		// carry it over to the other language. Moving to the bare URL hands the
		// choice to the cookie just written. That address is also the one the
		// edge can cache: a Worker route can't match `/?…` (see wrangler.toml).
		if (page.url.searchParams.has(LEAGUE_PARAM)) {
			void goto(home, { replace: true, reset: false });
		}
	}

	const leagueTeams = $derived(teams.filter((t) => t.league === league));

	// Medals are this browser's own, read once the page has mounted: the markup
	// the server sends is shared by every visitor and shows none. So a tile or a
	// tab gains its medal a moment after the page appears, and only for someone
	// who has earned one.
	const records = new RecordBook();
	onMount(() => records.load());

	/** What a team's medal was won for, to show on hovering over it. */
	function medalTip(medal: MedalKind): string {
		return i18n.m.game.medalTip(
			i18n.m.game.medals[medal],
			i18n.m.game.levels[levelForMedal(medal).key],
			records.season
		);
	}

	/** How many of a league's teams are held at gold this season, and of how many. */
	function golds(leagueId: LeagueId) {
		const ids = teams.filter((t) => t.league === leagueId).map((t) => t.id);
		return { count: records.loaded ? records.golds(ids) : 0, total: ids.length };
	}

	// A league's trophy is held while every one of its teams is at gold this
	// season, and the Memorial Cup while all three junior leagues are. A league
	// whose teams have not arrived has not been won. Like the medals, none of
	// this is in the markup the server sends.
	const trophies = $derived(
		trophiesHeld((id) => {
			const { count, total } = golds(id);
			return total > 0 && count === total;
		}, i18n.locale)
	);
</script>

<svelte:head>
	<title>{i18n.m.title}</title>
	<meta name="description" content={i18n.m.description} />
	<meta property="og:title" content={i18n.m.title} />
	<meta property="og:description" content={i18n.m.description} />
</svelte:head>

<div class="flex-1 bg-gray-950 text-white">
	<!-- More room above the title on a phone than on a wider screen: it is
	     where the trophies go there, and it is kept whether or not there are
	     any, so that the title is in one place for everybody. -->
	<header class="relative pt-12 pb-10 text-center sm:pt-10">
		<!-- The trophies this visitor holds, standing in a row above the title
		     with their feet just clear of it. Out of the flow, so that the title
		     is where it always is, with or without them.

		     On a screen with the room they are as tall as can be had: they take
		     up the padding above the title and the empty middle of the site nav
		     above that, which this row is laid over, their tops just clear of
		     the top of the page. That depends on how tall the nav is (3.25rem):
		     the row ends 2.75rem below the top of this header and is 5.75rem
		     tall.

		     A phone's nav has no empty middle, and six that tall would not fit
		     across one. There they are a size smaller and stand under the nav,
		     in the padding this header keeps for them. -->
		{#if trophies.length > 0}
			<ul
				class="absolute top-0 left-1/2 flex -translate-x-1/2 items-end gap-2 sm:top-auto sm:bottom-[calc(100%-2.75rem)] sm:gap-3"
				aria-label={i18n.m.trophies.title}
				data-trophies
			>
				{#each trophies as trophy (trophy)}
					{@const tip = i18n.m.trophies.tip(trophy, records.season)}
					<li class="flex">
						<Trophy {trophy} label={tip} {tip} class="h-12 text-gray-300 sm:h-23" />
					</li>
				{/each}
			</ul>
		{/if}
		<h1 class="font-condensed text-6xl font-black tracking-tight">Numbrrs</h1>
		<!-- Small on a phone, where at full size it runs to two lines and the
		     room is wanted above the title. -->
		<p class="mt-1 px-4 text-xs text-gray-400 sm:mt-2 sm:text-lg">{i18n.m.tagline}</p>
	</header>

	<main class="mx-auto max-w-5xl px-4 pb-12">
		<div class="mb-6 flex justify-center">
			<!-- Links in a nav, not a tablist: each one is an address the server
			     answers, and there is no tabpanel for a tab to control.

			     Preloading is off because the app-wide default would fetch a league's
			     page whenever the pointer crossed its tab, for a click that never
			     follows the link. -->
			<nav
				class="flex flex-wrap justify-center rounded-lg border border-white/10 bg-white/5 p-1"
				aria-label={i18n.m.home.league}
				data-sveltekit-preload-data="false"
			>
				{#each LEAGUES as option (option.id)}
					{@const gold = golds(option.id)}
					<a
						href="{home}?{LEAGUE_PARAM}={option.id}"
						aria-current={league === option.id ? 'page' : undefined}
						onclick={(event) => chooseLeague(event, option.id)}
						class="font-condensed flex flex-col items-center rounded-md px-2 py-1.5 text-sm font-bold tracking-widest uppercase transition-colors sm:px-5 {league ===
						option.id
							? 'bg-white/15 text-white'
							: 'text-gray-450 hover:text-gray-300'}"
					>
						{option.label[i18n.locale]}
						<!-- Gold only, and only once there is one to count: winning a
						     whole league is the hard thing to do, and a row of zeroes
						     under every tab would say nothing to a first visit. The
						     figures are for the eye; the words say what they count.

						     Smaller on a phone, where at full size the count is wider
						     than the tab's own label and five tabs with one each no
						     longer fit on a row. -->
						{#if gold.count > 0}
							<span
								class="flex items-center gap-0.5 font-sans text-[0.5625rem] font-semibold tracking-normal text-gray-300 normal-case [word-spacing:-0.1em] sm:gap-1 sm:text-[0.6875rem] sm:[word-spacing:normal]"
							>
								<Medal medal="gold" />
								<span aria-hidden="true">{gold.count} / {gold.total}</span>
								<span class="sr-only">{i18n.m.home.goldCount(gold.count, gold.total)}</span>
							</span>
						{/if}
					</a>
				{/each}
			</nav>
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
					{@const logo = teamLogo(team.league, team.abbreviation, team.logoUrl)}
					{@const name = teamName(i18n.locale, team)}
					{@const medal = records.loaded ? records.medal(team.id) : null}
					{@const fresh = records.loaded ? records.newCount(team.id, marks[team.id] ?? '') : 0}
					<a
						href={resolve('/[[lang=locale]]/game/[league]/[team]', {
							lang: i18n.lang,
							league: team.league,
							team: team.abbreviation
						})}
						class="team-tile group relative flex flex-col items-center gap-2 rounded-xl border p-4 transition-all duration-200 hover:scale-105"
						style="--glow: {colors.primary}44; border-color: {colors.primary}44; background: linear-gradient(160deg, {colors
							.darkGradient[0]}, {colors.darkGradient[1]});"
					>
						<!-- The best medal earned for the team this season, hanging from
						     the tile's top edge: its ribbon starts on the border, and it
						     is allowed to lap over the top of the logo. Out of the flow,
						     so a tile with one is laid out exactly like one without. It is
						     named, so the link reads as the medal and then the team.

						     Raised, here and on the count beside it, because the logo's
						     drop shadow makes the logo a layer of its own: coming later
						     in the markup, it would otherwise be painted on top. -->
						{#if medal}
							<span
								class="absolute -top-0.5 left-1/2 z-10 -translate-x-1/2 text-xl leading-none drop-shadow-md"
							>
								<Medal {medal} label={i18n.m.game.medals[medal]} tip={medalTip(medal)} />
							</span>
						{/if}
						<!-- On a team this visitor has played to the end: how many players
						     on its roster they have not named. Arrivals and changes of
						     number since, in other words, and a reason to come back. In
						     the corner, out of the flow like the medal. -->
						{#if fresh > 0}
							<span
								class="absolute top-1.5 right-1.5 z-10 rounded-full bg-white/15 px-1.5 py-0.5 text-[0.6875rem] leading-none font-semibold text-white"
							>
								{i18n.m.home.newPlayers(fresh, leagueGender(team.league))}
							</span>
						{/if}
						<!-- Decorative: the name is right below, inside the same link. -->
						<img
							src={logo.url}
							alt=""
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

<style>
	/* The glow color is per team, so it arrives via a custom property; the
	   hover behavior itself is plain CSS rather than event handlers. */
	.team-tile {
		transition: box-shadow 0.2s;
	}

	.team-tile:hover {
		box-shadow: 0 0 16px 2px var(--glow);
	}
</style>
