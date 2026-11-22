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
	};

	const { levels, value, onselect }: Props = $props();

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
