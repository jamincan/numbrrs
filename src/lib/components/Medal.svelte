<script lang="ts">
	import type { Medal } from '#lib/game.ts';

	type Props = {
		medal: Medal;
		/** Drawn grey: the medal that was being played for, and no longer can be won. */
		lost?: boolean;
		/** Names it for assistive technology. Left out where the words beside it
		 *  already say which medal it is, and it is decoration. */
		label?: string;
		/** What it was won for, shown beside it while the pointer is over it:
		 *  for a medal somebody holds, as opposed to one that says what a level
		 *  is worth. */
		tip?: string;
	};

	let { medal, lost = false, label, tip }: Props = $props();

	// Face and rim. Light enough to read on the dark page and on a team tile.
	const METAL: Record<Medal, [string, string]> = {
		bronze: ['#d98a4b', '#8f4f1f'],
		silver: ['#d5dae2', '#7d8694'],
		gold: ['#f6c93a', '#a97a08']
	};
	const GREY: [string, string] = ['#6b7280', '#4b5563'];

	const [face, rim] = $derived(lost ? GREY : METAL[medal]);
</script>

{#snippet drawing()}
	<!-- Sized by the text it sits in. -->
	<svg
		viewBox="0 0 24 24"
		class="inline-block h-[1.25em] w-[1.25em] shrink-0"
		role={label ? 'img' : undefined}
		aria-label={label}
		aria-hidden={label ? undefined : true}
		data-medal={lost ? 'lost' : medal}
	>
		<!-- Ribbon -->
		<path d="M7 1h4l2.5 8h-4z" fill={lost ? '#4b5563' : '#3b82f6'} />
		<path d="M17 1h-4l-2.5 8h4z" fill={lost ? '#374151' : '#1d4ed8'} />
		<!-- Disc -->
		<circle cx="12" cy="15.5" r="7" fill={face} stroke={rim} stroke-width="1.5" />
		<circle cx="12" cy="15.5" r="3.75" fill="none" stroke={rim} stroke-width="1" />
	</svg>
{/snippet}

{#if tip}
	<!-- A tooltip of the page's own rather than a `title`: that one takes a
	     second to appear, can't be styled, and never shows for a keyboard. This
	     shows while the pointer is over the medal, and also while whatever the
	     medal is inside has keyboard focus, which on the home page is the team's
	     tile.

	     Hidden from assistive technology, which has the medal's own name, and
	     set in its own small type whatever the text around the medal looks
	     like. It wraps, so that near the edge of a screen it stays on it. -->
	<span class="group/medal relative inline-flex">
		{@render drawing()}
		<span
			aria-hidden="true"
			data-medal-tip
			class="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 hidden w-max max-w-52 -translate-x-1/2 rounded-md bg-gray-950 px-2.5 py-1.5 text-center font-sans text-xs leading-snug font-medium tracking-normal text-white normal-case shadow-lg ring-1 ring-white/20 group-hover/medal:block in-focus-visible:block"
		>
			{tip}
		</span>
	</span>
{:else}
	{@render drawing()}
{/if}
