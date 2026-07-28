<script lang="ts">
	import CardBack from '$lib/components/CardBack.svelte';
	import HockeyCard from '$lib/components/HockeyCard.svelte';
	import type { DrawerLayout } from '$lib/drawer-layout.svelte';
	import type { GameState } from '$lib/game-state.svelte';
	import { getI18n } from '$lib/i18n/state.svelte';
	import type { Gender } from '$lib/i18n';
	import type { Team } from '$lib/types';

	const i18n = getI18n();

	const {
		team,
		game,
		gender,
		layout
	}: { team: Team; game: GameState; gender: Gender; layout: DrawerLayout } = $props();

	// The resolved card mounts still showing its number, then flips a frame
	// later — a CSS transition can't animate on initial render, and the card
	// needs to fly to the pile face-front before turning over.
	let shownCorrect = $state<boolean | null>(null);
	$effect(() => {
		const outcome = game.resolved?.correct;
		shownCorrect = null;
		if (outcome === undefined) return;
		let secondFrame = 0;
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				shownCorrect = outcome;
			});
		});
		return () => {
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
		};
	});
</script>

<!-- The card table: draw deck on the left, guessed pile on the right. One row
     at every breakpoint — the cards scale down instead of re-stacking, which
     also keeps the fly-to-pile animation a constant "one zone-width plus the
     gap". -->
<div bind:this={layout.cardTable} class="flex w-full max-w-xl flex-col items-center gap-4">
	<div class="flex w-full items-start justify-center gap-4">
		<!-- Draw deck -->
		<div class="card-slot">
			{#if game.current}
				{@const backs = Math.min(game.deck.length, 3)}
				{#each { length: backs }, i}
					<div
						class="absolute inset-0"
						style="transform: translate({(backs - i) * 4}px, {(backs - i) * 4}px);"
						aria-hidden="true"
					>
						<CardBack {team} />
					</div>
				{/each}
				{#key game.current.key}
					<div class="card-draw absolute inset-0">
						<HockeyCard {team} player={game.current.player} correct={null} />
					</div>
				{/key}
			{:else}
				<!-- Game over: the summary takes the emptied deck's spot. -->
				<div
					class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-green-500/30 bg-green-500/5 p-4 text-center"
				>
					<h2 class="text-xl font-bold text-green-400 sm:text-2xl">
						{i18n.m.game.congratulations}
					</h2>
					<!-- The team name is in the header rather than this sentence: French
					     would need the team's gender to pick the right article. -->
					<p class="text-xs text-gray-400 sm:text-sm">{i18n.m.game.allIdentified(gender)}</p>
					<!-- No accuracy to report when there was nothing to guess (a roster
					     where nobody has a number starts complete). -->
					{#if game.guesses > 0}
						<p class="text-xs text-gray-400 sm:text-sm">
							{i18n.m.game.accuracy(i18n.percent(game.guessableCount / game.guesses))}
						</p>
					{/if}
					<button
						onclick={() => game.reset()}
						class="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
					>
						{i18n.m.game.playAgain}
					</button>
				</div>
			{/if}
		</div>

		<!-- Guessed pile -->
		<div class="card-slot">
			<!-- The empty slot, visible until the first card lands. -->
			<div
				class="absolute inset-0 rounded-2xl border-2 border-dashed border-white/10"
				aria-hidden="true"
			></div>
			{#if game.previous}
				<!-- Underneath the top card, peeking out at an alternating angle so
				     the pile reads as a pile. -->
				<div
					class="absolute inset-0"
					style="rotate: {game.previous.key % 2 === 0 ? 2 : -2}deg;"
					aria-hidden="true"
				>
					<HockeyCard {team} player={game.previous.player} correct={game.previous.correct} />
				</div>
			{/if}
			{#if game.resolved}
				{#key game.resolved.key}
					<div class="card-fly absolute inset-0">
						<HockeyCard {team} player={game.resolved.player} correct={shownCorrect} />
					</div>
				{/key}
			{/if}
		</div>
	</div>

	<!-- The visual verdict is the card flip; this announces it to screen
	     readers. -->
	<p class="sr-only" role="status">
		{#if game.resolved}
			{game.resolved.correct ? i18n.m.card.correct : i18n.m.card.wrong}
			{game.resolved.player.firstName}
			{game.resolved.player.lastName}
		{/if}
	</p>

	<!-- Progress -->
	<p class="text-sm text-gray-400">
		{i18n.m.game.identified(game.identified.length, game.rosterLength, gender)}
	</p>
</div>

<style>
	/* The two card zones, always side by side and always equal. */
	.card-slot {
		position: relative;
		flex: 1 1 0;
		min-width: 0;
		aspect-ratio: 3 / 4;
		/* Width normally leads, capped at 18rem. When the viewport is short the
		   cap follows the height instead, so a phone in landscape shrinks the
		   cards rather than running them off the bottom: 11rem covers the nav,
		   header, progress line and the padding around them, and 0.75 converts
		   that height back into a width at the card's 3:4 aspect. */
		max-width: min(18rem, calc((100dvh - 11rem) * 0.75));
	}

	/* A drawn card lifts off the stack into place. */
	.card-draw {
		animation: draw-in 200ms ease-out;
	}

	/* A guessed card flies from the deck — one zone-width plus the flex gap to
	   the left — while HockeyCard's own transition turns it over. */
	.card-fly {
		animation: fly-in 500ms cubic-bezier(0.22, 1, 0.36, 1);
	}

	@keyframes draw-in {
		from {
			transform: translate(6px, 6px);
			opacity: 0;
		}
	}

	@keyframes fly-in {
		from {
			transform: translateX(calc(-100% - 1rem));
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.card-draw,
		.card-fly {
			animation: fade-in 300ms ease-out;
		}
	}
</style>
