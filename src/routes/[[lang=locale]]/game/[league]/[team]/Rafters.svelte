<script lang="ts">
	import type { Snippet } from 'svelte';
	import MedalIcon from '#lib/components/Medal.svelte';
	import type { Medal } from '#lib/game.ts';

	type Props = {
		/** The team's best medal this season. */
		medal?: Medal | null;
		/** What it was won for. Shown on hovering over the medal, and what the
		 *  medal is called for whoever can't see it. */
		medalTip?: string;
		/** Laid over the right-hand end of the row: the game puts the way into
		 *  a round about a roster's new players here. */
		extra?: Snippet;
	};

	let { medal = null, medalTip, extra }: Props = $props();
</script>

<!-- What a team has won, hung from the rafters: the row sits flush under the
     site nav, whose darker band is the beam, with the medal at its centre.
     Past seasons' banners will hang here too, outwards from the medal.

     How wide the row is, and so what the medal is centred on, is its parent's
     doing: the width of the cards under a bottom drawer, the whole page beside
     a side panel on a tall screen, and the panel alone on a short one.

     The row is there, at its full height, whether or not there is anything to
     hang in it. What a visitor has won is read from their own browser once the
     page has loaded, and a row that appeared then would push the cards down
     under their eyes on every visit.

     Whatever is laid over its right-hand end is allowed to cover what hangs
     there: it is something to act on, and gone once acted on, while the
     hangings are decoration. -->
<div
	class="relative mx-auto flex h-7 w-full max-w-xl shrink-0 items-start justify-center side:max-w-none"
>
	{#if medal}
		<!-- Up by the hair's breadth the drawing leaves above its ribbon, so the
		     ribbon meets the beam. -->
		<span class="-mt-px text-xl leading-none">
			<MedalIcon {medal} label={medalTip} tip={medalTip} />
		</span>
	{/if}
	{#if extra}
		<div class="absolute top-1/2 right-0 flex -translate-y-1/2 side:right-4">
			{@render extra()}
		</div>
	{/if}
</div>
