<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';

	let { data, form } = $props();

	const stats = $derived(data.state === 'open' ? data.stats : null);
	const sync = $derived(data.state === 'open' ? data.sync : null);

	// While a sync runs, refresh the page data every few seconds. This shows
	// progress, and it doubles as a keep-alive: the sync is fire-and-forget, and
	// Fly stops the machine once nothing is asking it for anything.
	$effect(() => {
		if (!sync?.running) return;
		const id = setInterval(() => invalidateAll(), 4000);
		return () => clearInterval(id);
	});

	// Scale the bars to the busiest day in the window, with a floor so a single
	// visitor doesn't render as a full-height bar on an otherwise empty chart.
	const peak = $derived(Math.max(4, ...(stats?.daily ?? []).map((d) => d.visitors)));
	const busiest = $derived(stats?.daily.reduce((a, b) => (b.visitors > a.visitors ? b : a)));
	const hasTraffic = $derived((stats?.daily ?? []).some((d) => d.views > 0));

	const shortDay = (day: string) => day.slice(5).replace('-', '/');
	const ago = (ms: number | null) => {
		if (ms == null) return 'never';
		const mins = Math.round((Date.now() - ms) / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
		return `${Math.round(mins / 1440)}d ago`;
	};
</script>

<svelte:head>
	<title>Admin · Numbrrs</title>
	<!-- Nothing here should ever reach an index. robots.txt disallows the path
	     too; this covers the crawler that ignores it. -->
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<!-- Chart roles as custom properties, so the one series hue and the status
     colors are named by their job rather than repeated as raw hex. Only the
     dark values exist: the app has no light mode. The series blue was validated
     at >=3:1 against this surface. -->
<div
	class="viz-root flex-1 bg-gray-950 px-6 py-8 text-white"
	style="--series-1:#3987e5; --status-critical:#d03b3b; --status-good:#0ca30c; --status-warning:#fab219;"
>
	<div class="mx-auto max-w-5xl">
		{#if data.state === 'unconfigured'}
			<h1 class="font-condensed text-3xl font-black">Admin</h1>
			<p class="mt-4 max-w-prose text-sm text-gray-400">
				<code class="rounded bg-white/10 px-1.5 py-0.5">ADMIN_TOKEN</code> isn't set on this
				deployment, so there's nothing to log in to. Set it with
				<code class="rounded bg-white/10 px-1.5 py-0.5">flyctl secrets set ADMIN_TOKEN=…</code>
				and reload.
			</p>
		{:else if data.state === 'locked'}
			<div class="mx-auto max-w-sm pt-12">
				<h1 class="font-condensed text-3xl font-black">Admin</h1>
				<form method="POST" action="?/login" class="mt-6">
					<label for="token" class="block text-sm text-gray-400">Admin token</label>
					<!-- type=password so browsers offer to save it: this form is the only
					     place the token is ever typed, and autofill is what keeps it out
					     of a URL or a note somewhere. -->
					<input
						id="token"
						name="token"
						type="password"
						autocomplete="current-password"
						required
						class="mt-2 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-white
							placeholder-gray-500 focus:border-white/40 focus:outline-none"
					/>
					{#if form?.message}
						<p class="mt-2 text-sm" style="color: var(--status-critical)">{form.message}</p>
					{/if}
					<button
						type="submit"
						class="mt-4 w-full rounded-lg bg-white px-3 py-2 font-semibold text-gray-950
							transition-colors hover:bg-gray-200"
					>
						Sign in
					</button>
				</form>
			</div>
		{:else if stats}
			<div class="flex flex-wrap items-baseline justify-between gap-4">
				<h1 class="font-condensed text-3xl font-black">Usage</h1>
				<div class="flex items-center gap-4 text-sm text-gray-400">
					{#if !stats.alertsConfigured}
						<span style="color: var(--status-critical)">● Alerts not configured</span>
					{:else}
						<span style="color: var(--status-good)">● Alerts on</span>
					{/if}
					<form method="POST" action="?/logout">
						<button type="submit" class="underline transition-colors hover:text-white"
							>Sign out</button
						>
					</form>
				</div>
			</div>

			<!-- Stat tiles: headline numbers, no plot. "Visitors" is always a daily
			     count; the multi-day tiles sum those dailies, which the footnote
			     spells out rather than letting the label imply unique people. -->
			<div class="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each [{ label: 'Visitors today', value: stats.today.visitors }, { label: 'Views today', value: stats.today.views }, { label: 'Visitors, 7 days', value: stats.last7.visitors }, { label: 'Visitors, 30 days', value: stats.last30.visitors }] as tile (tile.label)}
					<div class="rounded-lg border border-white/10 bg-white/5 p-4">
						<div class="text-3xl font-semibold">{tile.value.toLocaleString()}</div>
						<div class="mt-1 text-xs text-gray-400">{tile.label}</div>
					</div>
				{/each}
			</div>

			<section class="mt-8 rounded-lg border border-white/10 bg-white/5 p-5">
				<div class="flex items-baseline justify-between gap-4">
					<h2 class="font-semibold">Visitors per day</h2>
					<span class="text-xs text-gray-500">last {stats.windowDays} days</span>
				</div>

				{#if !hasTraffic}
					<p class="py-10 text-center text-sm text-gray-500">
						No visits recorded yet. Numbers appear here once someone who isn't a bot loads a page.
					</p>
				{:else}
					<!-- One series, so no legend: the heading names it. The peak day is
					     directly labelled; every other value lives in its hover tooltip
					     rather than cluttering the plot. -->
					<div
						class="mt-6 flex h-40 items-end gap-[2px]"
						role="img"
						aria-label="Daily visitors for the last {stats.windowDays} days"
					>
						{#each stats.daily as d (d.day)}
							<div class="group relative flex h-full flex-1 flex-col justify-end">
								<div
									class="w-full rounded-t-[4px] transition-opacity group-hover:opacity-80"
									style="height: {(d.visitors / peak) * 100}%; min-height: {d.visitors > 0
										? '2px'
										: '0'}; background: var(--series-1)"
								></div>
								<div
									class="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden
										-translate-x-1/2 rounded-md border border-white/15 bg-gray-900 px-2 py-1
										text-center text-xs whitespace-nowrap shadow-lg group-hover:block"
								>
									<div class="font-medium">{d.day}</div>
									<div class="text-gray-400">
										{d.visitors} visitor{d.visitors === 1 ? '' : 's'} · {d.views} view{d.views === 1
											? ''
											: 's'}
									</div>
								</div>
							</div>
						{/each}
					</div>
					<!-- Recessive baseline, and ticks only at the ends plus the peak. -->
					<div class="mt-1 border-t border-white/15"></div>
					<div class="mt-1.5 flex justify-between text-xs text-gray-500 tabular-nums">
						<span>{shortDay(stats.daily[0].day)}</span>
						{#if busiest && busiest.visitors > 0}
							<span class="text-gray-400">peak {busiest.visitors} on {shortDay(busiest.day)}</span>
						{/if}
						<span>{shortDay(stats.daily[stats.daily.length - 1].day)}</span>
					</div>
				{/if}

				<p class="mt-4 border-t border-white/10 pt-3 text-xs leading-relaxed text-gray-500">
					A visitor is counted once per day. The identifier behind it is rebuilt from a salt that
					rotates at midnight and is never stored, so someone who visits on two days counts once on
					each — the 7- and 30-day figures add those daily counts up rather than measuring unique
					people. Known bots are excluded.
				</p>
			</section>

			<div class="mt-6 grid gap-6 md:grid-cols-2">
				{#snippet ranked(
					title: string,
					rows: { key: string; label: string; views: number }[],
					empty: string
				)}
					<section class="rounded-lg border border-white/10 bg-white/5 p-5">
						<h2 class="font-semibold">{title}</h2>
						{#if rows.length === 0}
							<p class="mt-4 text-sm text-gray-500">{empty}</p>
						{:else}
							{@const max = Math.max(...rows.map((r) => r.views))}
							<ul class="mt-4 space-y-2">
								{#each rows as row (row.key)}
									<li class="grid grid-cols-[1fr_auto] items-center gap-3 text-sm">
										<div class="min-w-0">
											<div class="truncate">{row.label}</div>
											<div
												class="mt-1 h-1.5 rounded-full"
												style="width: {(row.views / max) * 100}%; background: var(--series-1)"
											></div>
										</div>
										<span class="text-gray-400 tabular-nums">{row.views}</span>
									</li>
								{/each}
							</ul>
						{/if}
					</section>
				{/snippet}

				{@render ranked(
					'Top teams',
					stats.topTeams.map((t) => ({
						key: `${t.league}:${t.team}`,
						label: t.name,
						views: t.views
					})),
					'No team pages opened yet.'
				)}
				{@render ranked(
					'Leagues',
					stats.topLeagues.map((l) => ({
						key: l.league ?? '?',
						label: (l.league ?? '?').toUpperCase(),
						views: l.views
					})),
					'No league pages opened yet.'
				)}
				{@render ranked(
					'Referrers',
					stats.referrers.map((r) => ({
						key: r.host ?? '?',
						label: r.host ?? '?',
						views: r.views
					})),
					'Nothing yet — everyone so far arrived directly or from a link that sent no referrer.'
				)}
				{@render ranked(
					'Language',
					stats.locales.map((l) => ({
						key: l.locale,
						label: l.locale === 'fr' ? 'French' : 'English',
						views: l.views
					})),
					'No page views yet.'
				)}
			</div>

			<section class="mt-6 rounded-lg border border-white/10 bg-white/5 p-5">
				<h2 class="font-semibold">Recent errors</h2>
				{#if stats.recentErrors.length === 0}
					<p class="mt-4 text-sm" style="color: var(--status-good)">
						● No errors recorded. Nothing has thrown since the table was last pruned.
					</p>
				{:else}
					<ul class="mt-4 space-y-3">
						{#each stats.recentErrors as err (err.fingerprint)}
							<li class="rounded-md border border-white/10 bg-gray-950/60 p-3 text-sm">
								<div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
									<!-- Source and count carry the meaning as text; the dot is
									     decoration beside them, never the signal on its own. -->
									<span class="font-medium" style="color: var(--status-critical)">
										● {err.source}
									</span>
									<span class="text-gray-400">{err.route ?? '—'}</span>
									<span class="ml-auto text-xs text-gray-500 tabular-nums">
										{err.count}× · last {ago(err.lastSeen)}
									</span>
								</div>
								<p class="mt-1.5 break-words">{err.message}</p>
								{#if err.stack}
									<details class="mt-2">
										<summary class="cursor-pointer text-xs text-gray-500 hover:text-gray-300">
											stack
										</summary>
										<pre
											class="mt-2 overflow-x-auto rounded bg-black/40 p-2 text-xs text-gray-400">{err.stack}</pre>
									</details>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			{#if sync}
				<section class="mt-6 rounded-lg border border-white/10 bg-white/5 p-5">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 class="font-semibold">Roster data</h2>
							<p class="mt-1 text-xs text-gray-500">
								Rosters refresh on their own when someone opens a stale team. This forces every
								league now.
							</p>
						</div>
						<form method="POST" action="?/resync" use:enhance>
							<button
								type="submit"
								disabled={sync.running}
								class="rounded-lg bg-white px-3 py-2 text-sm font-semibold text-gray-950
									transition-colors hover:bg-gray-200 disabled:cursor-not-allowed
									disabled:bg-white/20 disabled:text-gray-400"
							>
								{sync.running ? 'Syncing…' : 'Resync all rosters'}
							</button>
						</form>
					</div>

					{#if form?.message}
						<p class="mt-3 text-sm text-gray-400">{form.message}</p>
					{/if}

					{#if sync.running}
						<!-- Progress is a single measure against a known total, so it reads
						     as one bar rather than a chart. -->
						<div class="mt-4">
							<div class="flex items-baseline justify-between text-xs text-gray-400">
								<span>Started {ago(sync.startedAt)}</span>
								<span class="tabular-nums">{sync.totalDone} / {sync.totalTeams} teams</span>
							</div>
							<div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
								<div
									class="h-full rounded-full transition-[width] duration-500"
									style="width: {sync.totalTeams
										? (sync.totalDone / sync.totalTeams) * 100
										: 0}%; background: var(--series-1)"
								></div>
							</div>
							<p class="mt-2 text-xs text-gray-500">
								Leave this page open — the sync is paced to stay polite to the leagues' APIs, and
								this tab is what keeps the machine awake while it works.
							</p>
						</div>
					{/if}

					<ul class="mt-4 space-y-2 text-sm">
						{#each sync.leagues as league (league.id)}
							<li
								class="grid grid-cols-[3rem_1fr_auto] items-baseline gap-3 border-t border-white/5 pt-2"
							>
								<span class="font-condensed font-bold tracking-wide">{league.label}</span>
								<span class="text-gray-400">
									{league.teams} team{league.teams === 1 ? '' : 's'}
									{#if league.stale > 0}
										· <span style="color: var(--status-warning)">{league.stale} stale</span>
									{/if}
								</span>
								<span class="text-xs text-gray-500 tabular-nums">
									{#if sync.running && league.done > 0}
										{league.done}/{league.teams}
									{:else if league.oldestRoster != null}
										oldest {ago(league.oldestRoster)}
									{:else}
										list {ago(league.teamListSyncedAt)}
									{/if}
								</span>
							</li>
						{/each}
					</ul>
				</section>
			{/if}
		{/if}
	</div>
</div>
