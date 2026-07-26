<script lang="ts">
	import type { Player, Team } from '$lib/types';
	import { getI18n } from '$lib/i18n/state.svelte';
	import { positionName } from '$lib/i18n/messages';
	import { leagueGender } from '$lib/leagues';
	import { teamLogo } from '$lib/logos';
	import { getTeamColors } from '$lib/team-colors';
	import { teamName } from '$lib/team-names';

	const i18n = getI18n();

	type Props = {
		player: Player;
		team: Team;
		correct?: boolean | null;
	};

	let { player, team, correct = null }: Props = $props();

	let colors = $derived(getTeamColors(team.league, team.abbreviation));
	let primaryColor = $derived(colors?.primary ?? '#555555');
	let lightGradient = $derived(colors?.lightGradient ?? [primaryColor, primaryColor]);
	let darkGradient = $derived(colors?.darkGradient ?? ['#1a1a2e', '#16213e']);
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
</script>

<!-- Sized by the parent: the card fills its container's width at a 3:4 aspect
     and every internal measurement is in cqw, so two cards can share a phone
     screen. The @container sits on its own wrapper rather than the perspective
     element — containment on an ancestor of the 3D chain risks flattening the
     flip. -->
<div class="@container aspect-[3/4] w-full">
	<div class="group h-full w-full bg-transparent perspective-midrange">
		<div
			class="relative h-full w-full transition-transform duration-500 transform-3d data-[flipped=true]:rotate-y-180 motion-reduce:transition-none"
			data-flipped={flipped}
		>
			<section
				class="absolute inset-0 h-full w-full overflow-clip rounded-2xl border-2 shadow-2xl backface-hidden"
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
					<span
						class="font-condensed text-[4.5cqw] font-bold tracking-widest text-white/70 uppercase"
					>
						{displayTeamName}
					</span>
					<span
						class="font-condensed mt-[3cqw] text-[34cqw] leading-none font-black text-white drop-shadow-lg"
					>
						#{sweaterNumber}
					</span>
					<span
						class="font-condensed mt-[5cqw] text-[4.5cqw] font-semibold tracking-widest text-white/50 uppercase"
					>
						{i18n.m.card.prompt}
					</span>
				</div>
			</section>
			<section
				class="absolute h-full w-full rotate-y-180 overflow-clip rounded-2xl border-2 shadow-2xl backface-hidden"
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
						<img
							src={headshotUrl}
							alt={playerName}
							class="h-[38cqw] w-[38cqw] rounded-full border-2 object-cover shadow-lg"
							style="border-color: {primaryColor};"
						/>
					{/if}
					<span class="font-condensed mt-[3cqw] text-[8.5cqw] font-bold text-white"
						>{playerName}</span
					>
					<span class="font-condensed text-[12.5cqw] font-black" style="color: {primaryColor};"
						>#{sweaterNumber}</span
					>
					<span class="text-[5cqw] text-gray-400">{position}</span>
					{#if correct === true}
						<span
							class="font-condensed mt-[2cqw] rounded-full bg-green-600 px-[5.5cqw] py-[1.5cqw] text-[5cqw] font-bold text-white"
						>
							{i18n.m.card.correct}
						</span>
					{:else if correct === false}
						<span
							class="font-condensed mt-[2cqw] rounded-full bg-red-600 px-[5.5cqw] py-[1.5cqw] text-[5cqw] font-bold text-white"
						>
							{i18n.m.card.wrong}
						</span>
					{/if}
				</div>
			</section>
		</div>
	</div>
</div>
