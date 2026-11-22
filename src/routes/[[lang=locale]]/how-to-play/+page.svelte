<script lang="ts">
	import { onMount, tick } from 'svelte';
	import Medal from '#lib/components/Medal.svelte';
	import { LEVELS } from '#lib/game.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import { RecordBook } from '#lib/records.svelte.ts';

	const i18n = getI18n();

	// Only the reset control needs the records, and only to know whether there
	// is anything to erase. Read once the page has mounted: the server's markup
	// is the same for everyone and holds nothing from anyone's browser.
	const records = new RecordBook();
	onMount(() => records.load());

	// The control asks before it erases, in the page rather than in a browser
	// dialog: a dialog can't be styled or translated, and some browsers let a
	// visitor silence them for good.
	let asking = $state(false);
	let done = $state(false);
	let confirmBox = $state<HTMLElement>();
	let resetButton = $state<HTMLElement>();
	let doneNote = $state<HTMLElement>();

	// Each step removes the control that was just pressed, so focus is handed
	// to whatever replaced it rather than dropped to the top of the page.
	async function ask() {
		asking = true;
		done = false;
		await tick();
		confirmBox?.focus();
	}

	async function cancel() {
		asking = false;
		await tick();
		resetButton?.focus();
	}

	async function erase() {
		records.reset();
		asking = false;
		done = true;
		await tick();
		doneNote?.focus();
	}
</script>

<svelte:head>
	<title>{i18n.m.howTo.title} · Numbrrs</title>
	<meta name="description" content={i18n.m.howTo.description} />
	<meta property="og:title" content="{i18n.m.howTo.title} · Numbrrs" />
	<meta property="og:description" content={i18n.m.howTo.description} />
</svelte:head>

<main class="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
	<h1 class="font-condensed mb-6 text-4xl font-black text-white">{i18n.m.howTo.title}</h1>

	<p class="mb-10 text-lg text-gray-300">{i18n.m.howTo.intro}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">{i18n.m.howTo.levelsTitle}</h2>
	<!-- The same four rows as the level menu on a team's page, each with what
	     the menu has no room to say. -->
	<dl class="mb-4 space-y-4">
		{#each LEVELS as level (level.key)}
			<div>
				<dt class="flex items-center gap-2 font-semibold text-white">
					{i18n.m.game.levelOption(
						i18n.m.game.levels[level.key],
						i18n.m.game.levelChoices(Number.isFinite(level.choices) ? level.choices : null)
					)}
					{#if level.medal}
						<Medal medal={level.medal} label={i18n.m.game.medals[level.medal]} />
					{/if}
				</dt>
				<dd class="text-gray-400">{i18n.m.howTo.levels[level.key]}</dd>
			</div>
		{/each}
	</dl>
	<p class="mb-10 text-gray-400">{i18n.m.howTo.quizBody}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">{i18n.m.howTo.missesTitle}</h2>
	<p class="mb-10 text-gray-400">{i18n.m.howTo.missesBody}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">{i18n.m.howTo.medalsTitle}</h2>
	<p class="mb-4 text-gray-400">{i18n.m.howTo.medalsBody}</p>
	<p class="mb-10 text-gray-400">{i18n.m.howTo.medalsWhere}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">{i18n.m.howTo.newTitle}</h2>
	<p class="mb-10 text-gray-400">{i18n.m.howTo.newBody}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">{i18n.m.howTo.seasonsTitle}</h2>
	<p class="mb-10 text-gray-400">{i18n.m.howTo.seasonsBody}</p>

	<h2 class="font-condensed mb-3 text-xl font-bold text-white">{i18n.m.howTo.recordsTitle}</h2>
	<p class="mb-4 text-gray-400">{i18n.m.howTo.recordsBody}</p>

	<!-- Nothing here until the records have been read: before that the page
	     can't say whether there is anything to erase. -->
	{#if done}
		<p bind:this={doneNote} tabindex="-1" role="status" class="text-gray-300 outline-none">
			{i18n.m.howTo.resetDone}
		</p>
	{:else if !records.loaded}
		<!-- Holds the control's place, so the footer doesn't move when it arrives. -->
		<div class="h-10"></div>
	{:else if !records.any}
		<p class="flex h-10 items-center text-gray-450">{i18n.m.howTo.recordsEmpty}</p>
	{:else if asking}
		<div
			bind:this={confirmBox}
			tabindex="-1"
			role="group"
			aria-label={i18n.m.howTo.reset}
			class="rounded-lg border border-red-500/40 bg-red-500/5 p-4 outline-none"
		>
			<p class="mb-3 text-gray-200">{i18n.m.howTo.resetConfirm}</p>
			<div class="flex flex-wrap gap-3">
				<button
					onclick={erase}
					class="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600"
				>
					{i18n.m.howTo.resetYes}
				</button>
				<button
					onclick={cancel}
					class="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
				>
					{i18n.m.howTo.resetCancel}
				</button>
			</div>
		</div>
	{:else}
		<button
			bind:this={resetButton}
			onclick={ask}
			class="h-10 rounded-lg border border-white/20 px-4 text-sm font-semibold text-white hover:bg-white/10"
		>
			{i18n.m.howTo.reset}
		</button>
	{/if}
</main>
