<script lang="ts">
	type Props = {
		name: string;
		color?: string;
		/** Drop the vertical padding where the surrounding layout supplies its
		 *  own spacing and the height matters (the landscape card column). */
		compact?: boolean;
	};

	let { name, color, compact = false }: Props = $props();
</script>

<!-- Just the team name: navigation is the browser's job (and the site logo),
     and the game's controls live in the nav bar. -->
<header class="px-6 {compact ? 'py-0' : 'py-4'}">
	<h1 class="text-center text-xl font-bold" style="color: {color ?? '#fff'};">
		{name}
	</h1>
</header>
