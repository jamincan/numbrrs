<script lang="ts">
	import type { Team } from '$lib/types';
	import { teamLogo } from '$lib/logos';
	import { getTeamColors } from '$lib/team-colors';

	const { team }: { team: Team } = $props();

	const colors = $derived(getTeamColors(team.league, team.abbreviation));
	const primaryColor = $derived(colors?.primary ?? '#555555');
	const darkGradient = $derived(colors?.darkGradient ?? ['#1a1a2e', '#16213e']);
	// Same constraint as the card faces: an opaque logo reads as a pale square,
	// not a watermark.
	const logo = $derived(teamLogo(team.league, team.abbreviation, team.logoUrl));
	const watermarkUrl = $derived(logo.opaque ? null : logo.url);
</script>

<!-- A face-down card in the draw pile. Deliberately generic — nothing on the
     back may hint at the number underneath, or expert mode leaks answers. -->
<div
	class="h-full w-full overflow-clip rounded-2xl border-2 shadow-xl"
	style="border-color: {primaryColor}44; background: linear-gradient(160deg, {darkGradient[0]}, {darkGradient[1]});"
>
	{#if watermarkUrl}
		<img
			src={watermarkUrl}
			alt=""
			aria-hidden="true"
			class="pointer-events-none h-full w-full rounded-[inherit] object-contain p-6 opacity-[0.06]"
		/>
	{/if}
</div>
