<script lang="ts">
	import CardBack from '#lib/components/CardBack.svelte';
	import HockeyCard from '#lib/components/HockeyCard.svelte';
	import type { DrawerLayout } from '#lib/drawer-layout.svelte.ts';
	import type { GameState } from '#lib/game-state.svelte.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import type { Gender } from '#lib/i18n/index.ts';
	import type { Team } from '#lib/types.ts';

	const i18n = getI18n();

	let {
		team,
		game,
		gender,
		layout,
		onplayagain,
		summary = $bindable()
	}: {
		team: Team;
		game: GameState;
		gender: Gender;
		layout: DrawerLayout;
		onplayagain: () => void;
		/** The end-of-game summary, for the parent to move focus to. */
		summary?: HTMLElement;
	} = $props();

	const uid = $props.id();

	// The resolved card mounts still showing its number, then flips a frame
	// later — a CSS transition can't animate on initial render, and the card
	// needs to fly to the pile face-front before turning over.
	//
	// What's remembered is which card has turned, not the verdict it turned to:
	// a verdict would still be set from the last guess while the next card
	// mounts, so that card would arrive already turned and never flip.
	let turnedKey = $state<number | null>(null);
	$effect(() => {
		const key = game.resolved?.key;
		if (key === undefined) return;
		let secondFrame = 0;
		const firstFrame = requestAnimationFrame(() => {
			secondFrame = requestAnimationFrame(() => {
				turnedKey = key;
			});
		});
		return () => {
			cancelAnimationFrame(firstFrame);
			cancelAnimationFrame(secondFrame);
		};
	});
	const shownCorrect = $derived(
		game.resolved && game.resolved.key === turnedKey ? game.resolved.correct : null
	);

	const accuracy = $derived(i18n.m.game.accuracy(i18n.percent(game.guessableCount / game.guesses)));

	// The guess in words, for whoever can't see the card turn: the verdict, who
	// wears the number, then either the number now up or how the game went.
	const announcement = $derived.by(() => {
		const resolved = game.resolved;
		// Only numbered players get cards, so the number is always there; the
		// type just can't say so.
		const sweaterNumber = resolved?.player.sweaterNumber;
		if (!resolved || sweaterNumber == null) return '';
		const result = i18n.m.game.guessResult(
			resolved.correct,
			sweaterNumber,
			`${resolved.player.firstName} ${resolved.player.lastName}`
		);
		const next = game.current?.player.sweaterNumber;
		return next != null
			? `${result} ${i18n.m.game.nextNumber(next)}`
			: `${result} ${i18n.m.game.allIdentified(gender)} ${accuracy}`;
	});
</script>

<!-- The card table: draw deck on the left, guessed pile on the right. One row
     at every breakpoint — the cards scale down instead of re-stacking, which
     also keeps the fly-to-pile animation a constant "one zone-width plus the
     gap". The row can wrap all the same, for the one case scaling down cannot
     serve: a viewport too narrow for two cards at the smallest size their text
     fits in, which is under 320px wide and so only ever a zoomed-in one. -->
<div bind:this={layout.cardTable} class="flex w-full max-w-xl flex-col items-center gap-4">
	<div class="flex w-full flex-wrap items-start justify-center gap-4">
		<!-- Draw deck -->
		<div class="card-slot">
			{#if !game.dealt}
				<!-- Not dealt yet: what the server renders, and what is on screen until
				     the page has hydrated. Only backs — which card comes up first is
				     decided in the browser, per visitor. The top one sits where the
				     drawn card is about to land, so nothing moves when it does. -->
				{@const backs = Math.min(game.guessableCount, 4)}
				{#each { length: backs }, i}
					<div
						class="absolute inset-0"
						style="transform: translate({(backs - 1 - i) * 4}px, {(backs - 1 - i) * 4}px);"
						aria-hidden="true"
					>
						<CardBack {team} />
					</div>
				{/each}
			{:else if game.current}
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
				<!-- Game over: the summary takes the emptied deck's spot. Focusable from
				     script only: the last guess removes the button that made it, and
				     focus lands here rather than on Play Again so that a key still
				     held down from that guess can't start a new game. -->
				<div
					bind:this={summary}
					role="group"
					tabindex="-1"
					aria-labelledby="{uid}-summary"
					class="flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-green-500/30 bg-green-500/5 p-4 text-center"
				>
					<h2 id="{uid}-summary" class="text-xl font-bold text-green-400 sm:text-2xl">
						{i18n.m.game.congratulations}
					</h2>
					<!-- The team name is in the header rather than this sentence: French
					     would need the team's gender to pick the right article. -->
					<p class="text-xs text-gray-400 sm:text-sm">{i18n.m.game.allIdentified(gender)}</p>
					<!-- No accuracy to report when there was nothing to guess. The page
					     doesn't start a game for a roster like that, but GameState
					     allows one, and it would divide by zero here. -->
					{#if game.guesses > 0}
						<p class="text-xs text-gray-400 sm:text-sm">{accuracy}</p>
					{/if}
					<button
						onclick={onplayagain}
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
	     readers. The region itself is here from the start, empty — one that
	     arrives with its text already in it is not reliably read out. Keying the
	     text on the card swaps the node on every guess, so each is announced as
	     a new message whether or not its wording differs from the last. -->
	<p class="sr-only" role="status">
		{#key game.resolved?.key}
			<span>{announcement}</span>
		{/key}
	</p>

	<!-- Progress -->
	<p class="text-sm text-gray-400">
		{i18n.m.game.identified(game.identified.length, game.rosterLength, gender)}
	</p>

	<!-- The cards are dealt by a script, so without one the face-down deck above
	     is all this page will ever show. -->
	<noscript>
		<p class="text-center text-sm text-gray-400">{i18n.m.game.noScript}</p>
	</noscript>
</div>

<style>
	/* The two card zones, always side by side and always equal. */
	.card-slot {
		position: relative;
		flex: 1 1 0;
		/* The narrowest a card can be and still hold its text at the sizes the
		   type bottoms out at, so the height rule below stops here rather than
		   shrinking the card towards nothing as the viewport gets shorter —
		   which is what zooming in does to it. Two of these and the gap between
		   them fit across 320px. */
		min-width: 8.25rem;
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
