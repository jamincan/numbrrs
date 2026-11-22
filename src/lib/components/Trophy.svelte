<script lang="ts">
	import { shapeOf, TONES, TROPHIES, type TrophyId } from '#lib/trophies.ts';

	type Props = {
		trophy: TrophyId;
		/** Names it for assistive technology. Left out where the words beside it
		 *  already say which trophy it is, and it is decoration. */
		label?: string;
		/** What it was won for, shown under it while the pointer is over it. */
		tip?: string;
		/**
		 * The width of the drawing's lines, in its own grid units, in place of
		 * the one it was drawn with. They scale with the drawing, so what is
		 * right at the size of a header is heavy across half a screen.
		 */
		weight?: number;
		/** Its height, as a height utility, and its colour, as a text colour:
		 *  silver unless told otherwise. Its width follows from its shape. */
		class?: string;
	};

	let { trophy, label, tip, weight, class: look = 'h-[1.5em] text-gray-300' }: Props = $props();

	const uid = $props.id();
	const drawing = $derived(TROPHIES[trophy]);
	const width = $derived(drawing.width ?? 24);
	const line = $derived(weight ?? drawing.stroke);
	const shapes = $derived(drawing.paths.map(shapeOf));
</script>

<!-- See #lib/trophies.ts for the drawings, and for what they are and are not.

     A solid one is painted through a mask: each shape is filled in, and then,
     unless it is one laid flat on another, a line is cut along its edge, in
     turn. Cut out rather than drawn over in the colour of the page, because
     the drawing can't know what it will be shown on; the cuts show whatever
     that is. The order matters, and is the drawing's own: a later shape fills
     over an earlier one's cut where the two meet, and then makes its own.

     What is painted through the mask is each shape in its own colour: the
     text colour, which is the silver, or that of what else the part is made
     of. A part that is a line and not a shape is drawn as one, in both. -->
{#snippet picture()}
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 {width} {drawing.height}"
		fill={drawing.style === 'solid' ? 'currentColor' : 'none'}
		stroke={drawing.style === 'solid' ? 'none' : 'currentColor'}
		stroke-width={line}
		stroke-linecap="round"
		stroke-linejoin="round"
		class="inline-block w-auto shrink-0 {look}"
		role={label ? 'img' : undefined}
		aria-label={label}
		aria-hidden={label ? undefined : true}
		data-trophy={trophy}
	>
		{#if drawing.style === 'solid'}
			<mask
				id="{uid}-cuts"
				maskUnits="userSpaceOnUse"
				x="0"
				y="0"
				{width}
				height={drawing.height}
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				{#each shapes as shape (shape.d)}
					{#if shape.thick}
						<path d={shape.d} fill="none" stroke="white" stroke-width={shape.thick} />
					{:else}
						<path
							d={shape.d}
							fill="white"
							stroke={shape.cut ? 'black' : 'none'}
							stroke-width={line}
						/>
					{/if}
				{/each}
			</mask>
			<g mask="url(#{uid}-cuts)">
				{#each shapes as shape (shape.d)}
					{@const colour = shape.tone ? TONES[shape.tone] : 'currentColor'}
					{#if shape.thick}
						<path d={shape.d} fill="none" stroke={colour} stroke-width={shape.thick} />
					{:else}
						<path d={shape.d} fill={colour} />
					{/if}
				{/each}
			</g>
		{:else}
			{#each shapes as shape (shape.d)}
				<path d={shape.d} />
			{/each}
		{/if}
	</svg>
{/snippet}

{#if tip}
	<!-- A tooltip of the page's own, as a medal has, and for the same reasons:
	     see Medal.svelte. Hidden from assistive technology, which has the
	     trophy's own name. -->
	<span class="group/trophy relative inline-flex">
		{@render picture()}
		<span
			aria-hidden="true"
			data-trophy-tip
			class="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 hidden w-max max-w-52 -translate-x-1/2 rounded-md bg-gray-950 px-2.5 py-1.5 text-center font-sans text-xs leading-snug font-medium tracking-normal text-white normal-case shadow-lg ring-1 ring-white/20 group-hover/trophy:block"
		>
			{tip}
		</span>
	</span>
{:else}
	{@render picture()}
{/if}
