<script lang="ts">
	import type { Snippet } from 'svelte';
	import { getNavSlot } from '$lib/nav-slot.svelte';

	const { children }: { children: Snippet } = $props();

	const slot = getNavSlot();

	// An effect rather than an init-time assignment for the teardown: leaving
	// the page must empty the nav again. (This also means the slot only fills
	// after hydration — the server has already rendered the nav by the time a
	// page component runs, so SSR could never include it anyway.)
	$effect(() => {
		slot.content = children;
		return () => {
			slot.content = null;
		};
	});
</script>

<!-- Renders nothing here: the layout renders `children` inside the nav. -->
