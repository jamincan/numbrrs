<script lang="ts">
	import type { Player, Team } from '#lib/types.ts';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import { positionName } from '#lib/i18n/messages.ts';
	import { leagueGender } from '#lib/leagues.ts';
	import { teamLogo } from '#lib/logos.ts';
	import { frontInk, getTeamColors, type Ink } from '#lib/team-colors.ts';
	import { teamName } from '#lib/team-names.ts';

	const i18n = getI18n();

	type Props = {
		player: Player;
		team: Team;
		correct?: boolean | null;
	};

	let { player, team, correct = null }: Props = $props();

	let colors = $derived(getTeamColors(team.league, team.abbreviation));
	let primaryColor = $derived(colors.primary);
	let lightGradient = $derived(colors.lightGradient);
	let darkGradient = $derived(colors.darkGradient);
	let displayTeamName = $derived(teamName(i18n.locale, team));
	let playerName = $derived(`${player.firstName} ${player.lastName}`);
	let sweaterNumber = $derived(player.sweaterNumber);
	let position = $derived(positionName(i18n.m, player.positionCode, leagueGender(team.league)));
	let headshotUrl = $derived(player.headshotUrl);
	let flipped = $derived(correct !== null);
	// A logo with a baked-in background can't be used as a watermark — it shows
	// up as a pale square over the card instead of the logo's shape.
	let logo = $derived(teamLogo(team.league, team.abbreviation, team.logoUrl));
	let watermarkUrl = $derived(logo.opaque ? null : logo.url);

	// How opaque each line of the front is, and how much shade it gets behind
	// it, is worked out per team: see frontInk.
	let ink = $derived(frontInk(colors));
	const inkStyle = ({ alpha, scrim }: Ink) => `--ink: ${alpha}; --scrim: ${scrim};`;
</script>

<!-- Sized by the parent: the card fills its container's width at a 3:4 aspect
     and every internal measurement is in cqw, so two cards can share a phone
     screen. The @container sits on its own wrapper rather than the perspective
     element — containment on an ancestor of the 3D chain risks flattening the
     flip.

     Type is the exception to "everything in cqw": each size is the larger of
     its cqw value and a floor in rem, so text on a small card stops shrinking
     where it would stop being readable, and grows with the browser's zoom and
     text size from there. Lines that no longer fit at the floor wrap, centred;
     their line-height and block padding add up to the 1.5 a single line had,
     so a card with room for its text is laid out as it always was.

     Both faces stay in the DOM for the flip, so the one turned away is hidden
     from assistive technology: it is still painted (the turn shows it on the
     way round), but a screen reader browsing the card being asked about must
     not find the answer on its back. inert does that in current browsers;
     aria-hidden says the same to anything that predates it. -->
<div class="@container aspect-[3/4] w-full">
	<div class="group h-full w-full bg-transparent perspective-midrange">
		<div
			class="relative h-full w-full transition-transform duration-500 transform-3d data-[flipped=true]:rotate-y-180 motion-reduce:transition-none"
			data-flipped={flipped}
		>
			<section
				class="absolute inset-0 h-full w-full overflow-clip rounded-2xl border-2 shadow-2xl backface-hidden"
				inert={flipped}
				aria-hidden={flipped}
				style="border-color: {primaryColor}66; box-shadow: 0 0 24px 4px {primaryColor}33; background: linear-gradient(160deg, {lightGradient[0]}, {lightGradient[1]});"
			>
				<!-- Watermark logo -->
				{#if watermarkUrl}
					<img
						src={watermarkUrl}
						alt=""
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 h-full w-full rounded-[inherit] object-contain p-[8cqw] opacity-[0.07]"
					/>
				{/if}

				<!-- Content -->
				<div class="relative flex h-full flex-col items-center justify-center p-[8cqw]">
					<!-- The captions' letter-spacing is a tenth of their cqw size, not
					     of the size they are drawn at: at the floor the letters are
					     larger and need no more room between them than they had. They
					     also reach a little into the card's padding, which is what
					     keeps the prompt on one line on a phone. -->
					<span
						class="ink font-condensed -mx-[2cqw] py-[0.15em] text-center text-[max(0.75rem,4.5cqw)] leading-[1.2] font-bold tracking-[0.45cqw] text-balance wrap-anywhere uppercase"
						style={inkStyle(ink.name)}
					>
						{displayTeamName}
					</span>
					<span
						class="ink font-condensed mt-[3cqw] text-[34cqw] leading-none font-black drop-shadow-lg"
						style={inkStyle(ink.number)}
					>
						#{sweaterNumber}
					</span>
					<span
						class="ink font-condensed -mx-[2cqw] mt-[5cqw] py-[0.15em] text-center text-[max(0.75rem,4.5cqw)] leading-[1.2] font-semibold tracking-[0.45cqw] text-balance wrap-anywhere uppercase"
						style={inkStyle(ink.prompt)}
					>
						{i18n.m.card.prompt}
					</span>
				</div>
			</section>
			<section
				class="absolute h-full w-full rotate-y-180 overflow-clip rounded-2xl border-2 shadow-2xl backface-hidden"
				inert={!flipped}
				aria-hidden={!flipped}
				style="border-color: {correct === true
					? '#22c55e'
					: correct === false
						? '#ef4444'
						: primaryColor}66; box-shadow: 0 0 24px 4px {correct === true
					? '#22c55e'
					: correct === false
						? '#ef4444'
						: primaryColor}33; background: linear-gradient(160deg, {darkGradient[0]}, {darkGradient[1]});"
			>
				<!-- Back -->
				<!-- Watermark logo -->
				{#if watermarkUrl}
					<img
						src={watermarkUrl}
						alt=""
						aria-hidden="true"
						class="pointer-events-none absolute inset-0 h-full w-full rounded-[inherit] object-contain p-[8cqw] opacity-[0.07]"
					/>
				{/if}

				<div
					class="relative flex h-full flex-col items-center justify-center gap-[1.5cqw] p-[8cqw]"
				>
					{#if headshotUrl}
						<!-- Decorative: the name is the next line down. The one thing
						     here that gives way: on a small card, where the text is at
						     its floor and a long name has wrapped, the picture shrinks
						     to leave them the room. -->
						<img
							src={headshotUrl}
							alt=""
							class="aspect-square h-[38cqw] min-h-0 w-auto rounded-full border-2 object-cover shadow-lg"
							style="border-color: {primaryColor};"
						/>
					{/if}
					<span
						class="font-condensed mt-[3cqw] py-[0.175em] text-center text-[max(0.875rem,8.5cqw)] leading-[1.15] font-bold text-balance wrap-anywhere text-white"
						>{playerName}</span
					>
					<!-- Never under 19px: at that size and weight WCAG counts it as
					     large text, which is the contrast the team colours are held
					     to on this background. -->
					<span
						class="font-condensed text-[max(1.1875rem,12.5cqw)] font-black"
						style="color: {primaryColor};">#{sweaterNumber}</span
					>
					<span class="text-center text-[max(0.75rem,5cqw)] text-gray-400">{position}</span>
					<!-- The mark says which it is to someone who cannot tell the green
					     from the red, at a size where the word alone is easy to miss. -->
					{#if correct === true}
						<span
							class="font-condensed mt-[2cqw] flex items-center gap-[0.3em] rounded-full bg-green-700 px-[5.5cqw] py-[1.5cqw] text-[max(0.75rem,5cqw)] font-bold text-white"
						>
							<svg
								viewBox="0 0 24 24"
								class="h-[0.9em] w-[0.9em]"
								fill="none"
								stroke="currentColor"
								stroke-width="4"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M4 13l5 5L20 6" />
							</svg>
							{i18n.m.card.correct}
						</span>
					{:else if correct === false}
						<span
							class="font-condensed mt-[2cqw] flex items-center gap-[0.3em] rounded-full bg-red-600 px-[5.5cqw] py-[1.5cqw] text-[max(0.75rem,5cqw)] font-bold text-white"
						>
							<svg
								viewBox="0 0 24 24"
								class="h-[0.9em] w-[0.9em]"
								fill="none"
								stroke="currentColor"
								stroke-width="4"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<path d="M6 6l12 12M18 6L6 18" />
							</svg>
							{i18n.m.card.wrong}
						</span>
					{/if}
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	/* A line of the card front: white, as opaque as its team's gradient needs,
	   over as much black as it needs. The shadow is the same black again,
	   feathering the edge so the shade reads as part of the card rather than as
	   a label; with no scrim both are fully transparent. */
	.ink {
		color: rgb(255 255 255 / var(--ink));
		background-color: rgb(0 0 0 / var(--scrim));
		border-radius: 0.35em;
		box-shadow: 0 0 0.6em 0.25em rgb(0 0 0 / var(--scrim));
	}
</style>
