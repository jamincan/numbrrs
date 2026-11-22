<script lang="ts">
	import { tick } from 'svelte';
	import { resolve } from '$app/paths';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import Medal from '#lib/components/Medal.svelte';
	import type { Level, LevelKey } from '#lib/game.ts';

	const i18n = getI18n();

	type Props = {
		levels: readonly Level[];
		value: LevelKey;
		onselect: (value: LevelKey) => void;
		/** Words for someone who has not played before, shown under the button
		 *  until they are sent away. */
		hint?: string;
		/** The hint has been read, or the menu found without it. */
		onhintdismiss?: () => void;
	};

	const { levels, value, onselect, hint, onhintdismiss }: Props = $props();

	const uid = $props.id();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let trigger = $state<HTMLElement>();
	let menu = $state<HTMLElement>();

	const currentName = $derived(i18n.m.game.levels[value]);

	// A menu button, as assistive technology expects one to behave: opening
	// moves focus into the menu (to the setting in force), the arrow keys, Home
	// and End move between items, and closing hands focus back to the button —
	// except when focus has already gone somewhere else, which is the other way
	// a menu closes.
	function items(): HTMLElement[] {
		return menu
			? [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')]
			: [];
	}

	async function openMenu() {
		// Whoever opens the menu has found it.
		if (hint) onhintdismiss?.();
		open = true;
		await tick();
		const all = items();
		(all.find((item) => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
	}

	function closeMenu() {
		open = false;
		trigger?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (!open) {
			// Closed, so the key was pressed on the button: the arrows open the menu
			// just as Enter and Space do through its click.
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				void openMenu();
			}
			return;
		}
		const all = items();
		// -1 when the key came from the button with the menu open, which the
		// arithmetic below turns into the first item going down and the last
		// going up.
		const at = all.indexOf(e.target as HTMLElement);
		let to: number;
		switch (e.key) {
			case 'ArrowDown':
				to = (at + 1) % all.length;
				break;
			case 'ArrowUp':
				to = at <= 0 ? all.length - 1 : at - 1;
				break;
			case 'Home':
				to = 0;
				break;
			case 'End':
				to = all.length - 1;
				break;
			case 'Escape':
				e.preventDefault();
				closeMenu();
				return;
			case 'Tab':
				// Forwards, focus leaves and onfocusout closes the menu. Backwards it
				// would land on the button with the menu still open behind it.
				if (e.shiftKey) {
					e.preventDefault();
					closeMenu();
				}
				return;
			default:
				return;
		}
		e.preventDefault();
		all[to]?.focus();
	}

	// Only when focus arrives somewhere else. Leaving for nowhere (no
	// relatedTarget) is a click on something unfocusable, which the window
	// handler below deals with — or, in Safari, a click on one of the menu's own
	// buttons, which that browser doesn't focus; closing on that would take the
	// item away before its click landed.
	function onfocusout(e: FocusEvent) {
		if (open && e.relatedTarget instanceof Node && !root?.contains(e.relatedTarget)) open = false;
	}
</script>

<!-- Close on any click outside the menu. -->
<svelte:window
	onclick={(e) => {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}}
/>

<!-- The handlers here catch events bubbling up from the button and the menu
     items; the wrapper itself is not a control, hence the ignore. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" bind:this={root} {onkeydown} {onfocusout}>
	<button
		bind:this={trigger}
		onclick={() => (open ? closeMenu() : void openMenu())}
		aria-label={i18n.m.game.levelCurrent(currentName)}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={open ? `${uid}-menu` : undefined}
		aria-describedby={hint && !open ? `${uid}-hint` : undefined}
		class="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 p-1 text-gray-400 transition-colors hover:text-white sm:pr-2"
		class:text-white={open}
	>
		<!-- Lucide "gauge" (ISC), inlined like the GitHub mark in the nav. -->
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="m12 14 4-4" />
			<path d="M3.34 19a10 10 0 1 1 17.32 0" />
		</svg>
		<!-- Room permitting, name the setting instead of making the gauge carry
		     the whole meaning. Hidden from screen readers either way: the
		     button's aria-label says the same thing whether or not there is room
		     for this, in words that include these so the button can be asked for
		     by what it shows. -->
		<span
			class="font-condensed hidden text-xs font-bold tracking-widest uppercase sm:inline"
			aria-hidden="true"
		>
			{currentName}
		</span>
	</button>

	<!-- For a first visit: what the button is for, said once, by a bubble that
	     hangs under it and points at it. Light on the dark page so that it is
	     seen, and it stays until it is sent away, the menu is opened, or the
	     page that asked for it says it is no longer wanted. Its words describe
	     the button, so they are read out with it; the link beside them goes to
	     the rules, which say what each level is, and following it is taken as
	     having read the hint.

	     Short, and no taller than two lines: it hangs over the top of the game,
	     and anything deeper covers the team's name on a phone and, beside a
	     side panel, the very button a new player has to press next.

	     On a phone it is centred on the button, which is near the middle of
	     the nav there, and narrow enough to stay on the screen either side of
	     it, with the link on a line of its own. With more room it is one line,
	     ending where the button ends: the button is near the right-hand edge
	     then, and a line that long centred on it would run off the screen. -->
	{#if hint && !open}
		<div
			data-level-hint
			class="absolute top-full left-1/2 z-40 mt-2 flex w-max max-w-[17rem] -translate-x-1/2 items-start gap-1 rounded-lg bg-white py-1 pr-1 pl-3 text-left font-sans text-xs leading-tight font-semibold tracking-normal text-gray-900 normal-case shadow-2xl sm:right-0 sm:left-auto sm:mt-2.5 sm:max-w-none sm:translate-x-0 sm:items-center"
		>
			<span
				class="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-white sm:right-8 sm:left-auto sm:translate-x-0"
				aria-hidden="true"
			></span>
			<span class="relative flex flex-col sm:flex-row sm:gap-1.5 sm:py-0.5">
				<span id="{uid}-hint">{hint}</span>
				<a
					href={resolve('/[[lang=locale]]/how-to-play', { lang: i18n.lang })}
					onclick={() => onhintdismiss?.()}
					class="text-blue-700 underline underline-offset-2 hover:text-blue-900"
				>
					{i18n.m.howTo.title}
				</a>
			</span>
			<button
				onclick={() => onhintdismiss?.()}
				aria-label={i18n.m.game.levelHintDismiss}
				class="relative shrink-0 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900"
			>
				<!-- Lucide "x" -->
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2.5"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
				>
					<path d="M18 6 6 18" />
					<path d="m6 6 12 12" />
				</svg>
			</button>
		</div>
	{/if}

	{#if open}
		<div
			bind:this={menu}
			id="{uid}-menu"
			role="menu"
			aria-label={i18n.m.game.levelLabel}
			class="absolute right-0 z-50 mt-2 w-max max-w-[calc(100vw-1rem)] rounded-lg border border-white/10 bg-gray-900 py-1 shadow-2xl"
		>
			{#each levels as level (level.key)}
				{@const active = value === level.key}
				<!-- Out of the tab order: within a menu the arrow keys do the moving,
				     and Tab leaves it.

				     A row says what the level is, not just what it is called: how many
				     names each card offers, and the medal a run without a miss earns.
				     The medal is a named picture, so it is part of what the row is
				     called. -->
				<button
					role="menuitemradio"
					aria-checked={active}
					tabindex="-1"
					onclick={() => {
						onselect(level.key);
						closeMenu();
					}}
					class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap hover:bg-white/10 {active
						? 'text-white'
						: 'text-gray-400'}"
				>
					<span class="w-3.5 shrink-0">
						{#if active}
							<!-- Lucide "check" -->
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="14"
								height="14"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
								aria-hidden="true"
							>
								<path d="M20 6 9 17l-5-5" />
							</svg>
						{/if}
					</span>
					<span class="flex-1">
						{i18n.m.game.levelOption(
							i18n.m.game.levels[level.key],
							i18n.m.game.levelChoices(Number.isFinite(level.choices) ? level.choices : null)
						)}
					</span>
					{#if level.medal}
						<Medal medal={level.medal} label={i18n.m.game.medals[level.medal]} />
					{/if}
				</button>
			{/each}
			<!-- The rules, where the levels are chosen: this menu is the one place
			     on the page that names them, and the nav has no room on a phone for
			     a button of its own. A game in progress is kept for the tab, so
			     following the link doesn't lose it. -->
			<div role="separator" class="my-1 border-t border-white/10"></div>
			<a
				role="menuitem"
				tabindex="-1"
				href={resolve('/[[lang=locale]]/how-to-play', { lang: i18n.lang })}
				class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm whitespace-nowrap text-gray-400 hover:bg-white/10 hover:text-white"
			>
				<span class="w-3.5 shrink-0"></span>
				{i18n.m.howTo.title}
			</a>
		</div>
	{/if}
</div>
