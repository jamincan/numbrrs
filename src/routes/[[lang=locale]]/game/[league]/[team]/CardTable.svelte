<script lang="ts">
	import CardBack from '#lib/components/CardBack.svelte';
	import HockeyCard from '#lib/components/HockeyCard.svelte';
	import Medal from '#lib/components/Medal.svelte';
	import type { DrawerLayout } from '#lib/drawer-layout.svelte.ts';
	import type { GameState } from '#lib/game-state.svelte.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import type { Gender } from '#lib/i18n/index.ts';
	import type { Score } from '#lib/records.ts';
	import type { Team } from '#lib/types.ts';

	const i18n = getI18n();

	let {
		team,
		game,
		gender,
		layout,
		onplayagain,
		ontrylevel,
		best = null,
		summary = $bindable()
	}: {
		team: Team;
		game: GameState;
		gender: Gender;
		layout: DrawerLayout;
		onplayagain: () => void;
		/** Leave Learn for the first quiz level, from its end screen. */
		ontrylevel: () => void;
		/** The end-of-game summary, for the parent to move focus to. */
		/** The best finished run this season at the level this one counts as. */
		best?: Score | null;
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

	const fullName = (player: { firstName: string; lastName: string }) =>
		`${player.firstName} ${player.lastName}`;

	const bestLine = $derived(
		best ? i18n.m.game.best(i18n.m.game.levels[game.countsAs], best[0], best[1]) : ''
	);
	const score = $derived(i18n.m.game.firstTry(game.firstTry, game.guessableCount));
	// A level's medal is only talked about once the cards are dealt: the level is
	// read from this browser's storage, which the server's markup knows nothing of.
	const stake = $derived(game.dealt ? game.stake : null);
	const earned = $derived(
		stake && game.perfect ? i18n.m.game.medalEarned(i18n.m.game.medals[stake]) : null
	);

	// After a wrong guess the card that turns over says who does wear the number.
	// This is the other half: the number of the player who was picked instead.
	const pickedLine = $derived.by(() => {
		const picked = game.resolved?.picked;
		return picked?.sweaterNumber != null
			? i18n.m.game.wears(fullName(picked), picked.sweaterNumber)
			: '';
	});

	// What the progress bar says to whoever can't see it: players still to be
	// found, and which of Learn's two parts that count belongs to; then, at a
	// level with a medal, whether a run without a miss is still on. It used to
	// be a line of its own under the bar, which took a row of a phone's screen
	// to say what the bar and the cards already show. Before the cards are
	// dealt the level isn't known (it is this browser's own setting), so the
	// plain count stands.
	const progressText = $derived.by(() => {
		const count =
			!game.dealt || game.phase === null
				? i18n.m.game.remaining(game.remaining)
				: game.phase === 'learn'
					? i18n.m.game.toLearn(game.remaining)
					: i18n.m.game.finalLap(game.remaining);
		if (!stake) return count;
		const medal = game.perfect
			? i18n.m.game.medalInReach(i18n.m.game.medals[stake])
			: i18n.m.game.medalLost;
		return `${count}. ${medal}`;
	});

	// Each move in words, for whoever can't see the cards: after a guess, the
	// verdict and who wears the number; then what is up now, or how the game
	// went. Nothing is said for a deal or a restored game, which are not moves.
	const announcement = $derived.by(() => {
		if (game.lastMove === null) return '';
		const parts: (string | null)[] = [];
		const resolved = game.resolved;
		// Only numbered players get cards, so the number is always there; the
		// type just can't say so.
		if (game.lastMove === 'guess' && resolved?.player.sweaterNumber != null) {
			parts.push(
				i18n.m.game.guessResult(
					resolved.correct,
					resolved.player.sweaterNumber,
					fullName(resolved.player)
				),
				pickedLine
			);
		}
		const card = game.current;
		if (!card) {
			parts.push(i18n.m.game.allIdentified(gender), score, earned);
		} else if (card.player.sweaterNumber != null) {
			// The guess that learned the last player is the one that starts the
			// final lap: nothing has been found or missed in it yet.
			const lapStarting =
				game.phase === 'lap' &&
				game.lastMove === 'guess' &&
				game.outcomes.length === 0 &&
				game.missed.length === 0;
			if (lapStarting) parts.push(i18n.m.game.lapStart);
			parts.push(
				card.kind === 'intro'
					? i18n.m.game.introduced(card.player.sweaterNumber, fullName(card.player))
					: i18n.m.game.nextNumber(card.player.sweaterNumber)
			);
		}
		return parts.filter(Boolean).join(' ');
	});
</script>

<!-- The card table: draw deck on the left, guessed pile on the right. One row
     at every breakpoint — the cards scale down instead of re-stacking, which
     also keeps the fly-to-pile animation a constant "one zone-width plus the
     gap". The row can wrap all the same, for the one case scaling down cannot
     serve: a viewport too narrow for two cards at the smallest size their text
     fits in, which is under 320px wide and so only ever a zoomed-in one. -->
<div bind:this={layout.cardTable} class="flex w-full max-w-xl flex-col items-center gap-2">
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
						<!-- An introduction is dealt face up: there is nothing to guess,
						     only a player to look at before being asked about them. -->
						<HockeyCard
							{team}
							player={game.current.player}
							correct={null}
							faceUp={game.current.kind === 'intro'}
						/>
					</div>
				{/key}
			{:else}
				<!-- Game over: the summary takes the emptied deck's spot. Focusable from
				     script only: the last guess removes the button that made it, and
				     focus lands here rather than on Play Again so that a key still
				     held down from that guess can't start a new game.

				     A container, so the heading can be sized to it: the word is long
				     and can't wrap, and the box is as narrow as a card on a small
				     phone. -->
				<div
					bind:this={summary}
					role="group"
					tabindex="-1"
					aria-labelledby="{uid}-summary"
					class="@container flex h-full w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-green-500/30 bg-green-500/5 p-2 text-center"
				>
					<h2 id="{uid}-summary" class="text-[min(1.5rem,12cqw)] font-bold text-green-400">
						{i18n.m.game.congratulations}
					</h2>
					<!-- The sentence that says so in full is in the announcement; a card
					     slot on a phone has room for the heading and the score. No score
					     to report when there was nothing to guess: the page doesn't
					     start a game for a roster like that, but GameState allows one. -->
					{#if game.guesses > 0}
						<p class="text-xs text-gray-300 sm:text-sm">{score}</p>
					{/if}
					{#if stake && earned}
						<p class="flex items-center gap-1.5 text-xs font-semibold text-white sm:text-sm">
							<Medal medal={stake} />
							{earned}
						</p>
					{/if}
					<button
						onclick={onplayagain}
						class="mt-1 rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20"
					>
						{i18n.m.game.playAgain}
					</button>
					<!-- Learn earns no medal; what it earns is being ready for the first
					     level that does. -->
					{#if game.countsAs === 'learn'}
						<button
							onclick={ontrylevel}
							class="rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold hover:bg-white/10"
						>
							{i18n.m.game.tryLevel(i18n.m.game.levels.easy)}
						</button>
					{/if}
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
		{#key game.moves}
			<span>{announcement}</span>
		{/key}
	</p>

	<!-- Held open at one line's height whether or not there is anything to say,
	     so the drawer below doesn't move when a wrong guess fills it. -->
	<p class="min-h-5 text-center text-sm text-gray-300">{pickedLine}</p>

	{#if game.current || !game.dealt}
		<!-- Progress. The roster can't show it at a closed-book level, and under a
		     bottom drawer it is out of sight at any level, so it is here: one
		     segment per player, filled as each is found. A player who took more
		     than one try is marked by shape as well as colour. The count, and
		     what has become of the medal, are said and not shown. -->
		<div
			role="progressbar"
			aria-label={i18n.m.game.progress}
			aria-valuemin="0"
			aria-valuemax={game.guessableCount}
			aria-valuenow={game.guessableCount - game.remaining}
			aria-valuetext={progressText}
			class="flex h-1.5 w-full items-center gap-px"
		>
			{#each { length: game.guessableCount }, i}
				{@const outcome = game.outcomes[i]}
				<span
					class="flex-1 rounded-full {outcome === undefined
						? 'h-full bg-white/10'
						: outcome
							? 'h-full bg-green-500'
							: 'h-0.5 bg-red-400'}"
				></span>
			{/each}
		</div>
	{:else}
		<!-- Game over. The best run at this level so far this season, which this
		     one may just have become: something to beat next time. -->
		{#if bestLine}
			<p class="text-center text-sm text-gray-400">{bestLine}</p>
		{/if}
	{/if}
	{#if game.dealt && !game.current && game.missedPlayers.length > 0}
		<!-- Game over: who to look at again, each with the number they wear. The
		     drawer is gone by now, so this has the room it left. -->
		<section class="w-full" aria-labelledby="{uid}-missed">
			<h2
				id="{uid}-missed"
				class="mb-1.5 text-xs font-semibold tracking-wider text-gray-450 uppercase"
			>
				{i18n.m.game.missedHeading}
			</h2>
			<ul class="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
				{#each game.missedPlayers as player (player.id)}
					<li
						class="flex flex-row justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-200"
					>
						<span>{fullName(player)}</span>
						<span class="font-semibold text-white">{player.sweaterNumber}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

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
		   cap follows the height instead, so that the cards shrink rather than
		   crowd out what has to share the screen with them. 0.75 converts a
		   height back into a width at the card's 3:4 aspect.

		   Under a bottom drawer that is everything: 24.5rem covers the nav, the
		   rafters row, the team's name, the lines under the cards, and a drawer
		   showing three rows of answers, which is what Easy needs. It only bites
		   on a phone both narrow and short; on anything taller the width still
		   decides. */
		max-width: min(18rem, calc((100dvh - 24.5rem) * 0.75));
	}

	/* With the roster down the right-hand side (the `side` variant's query,
	   word for word) the drawer and the rafters are beside the cards, not above
	   or below them: 13rem covers the nav, the name, the lines under the cards
	   and the padding around them. This is what shrinks the cards on a phone in
	   landscape rather than running them off the bottom. */
	@media (min-width: 600px) and (orientation: landscape) {
		.card-slot {
			max-width: min(18rem, calc((100dvh - 13rem) * 0.75));
		}
	}

	/* And where that screen is tall enough for the rafters to run across the
	   top (the `side-tall` variant's query), they are above the cards again,
	   and their 1.75rem is counted. From about 620px of height up the cards are
	   at their full size regardless. */
	@media (min-width: 600px) and (orientation: landscape) and (min-height: 600px) {
		.card-slot {
			max-width: min(18rem, calc((100dvh - 14.75rem) * 0.75));
		}
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
