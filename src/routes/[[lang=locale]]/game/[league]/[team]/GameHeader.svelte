<script lang="ts">
	type Props = {
		name: string;
		color?: string;
	};

	let { name, color }: Props = $props();
</script>

<!-- Just the team name: navigation is the browser's job (and the site logo),
     and the game's controls live in the nav bar. -->
<header class="px-6 py-4">
	<h1 class="text-center text-xl font-bold" style="color: {color ?? '#fff'};">
		{name}
	</h1>
</header>
