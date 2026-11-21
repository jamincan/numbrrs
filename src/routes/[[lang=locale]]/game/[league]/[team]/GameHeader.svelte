<script lang="ts">
	type Props = {
		name: string;
		color: string;
		/** For the header at the top of the game's card column, rather than
		 *  across a page of its own. Under a bottom drawer it looks the same as
		 *  that: a band the width of the page, which means reaching back out
		 *  through the column's side padding. Beside a side panel it gives up
		 *  its vertical padding, because the column supplies the spacing there
		 *  and the height is needed for the cards. */
		inCardColumn?: boolean;
	};

	let { name, color, inCardColumn = false }: Props = $props();
</script>

<!-- Just the team name: navigation is the browser's job (and the site logo),
     and the game's controls live in the nav bar. -->
<header
	class="px-6 py-4 {inCardColumn ? '-mx-4 self-stretch side:mx-0 side:self-auto side:py-0' : ''}"
>
	<h1 class="text-center text-xl font-bold" style="color: {color};">
		{name}
	</h1>
</header>
