<script lang="ts">
	import { tick } from 'svelte';
	import { getI18n } from '#lib/i18n/state.svelte.ts';
	import type { Messages } from '#lib/i18n/messages.ts';

	const i18n = getI18n();

	type Option = { key: keyof Messages['game']['difficulty']; value: number };
	type Props = {
		options: readonly Option[];
		value: number;
		onselect: (value: number) => void;
	};

	const { options, value, onselect }: Props = $props();

	const uid = $props.id();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let trigger = $state<HTMLElement>();
	let menu = $state<HTMLElement>();

	const current = $derived(options.find((o) => o.value === value));
	const currentName = $derived(current && i18n.m.game.difficulty[current.key]);

	// A menu button, as assistive technology expects one to behave: opening
	// moves focus into the menu (to the setting in force), the arrow keys, Home
	// and End move between items, and closing hands focus back to the button —
	// except when focus has already gone somewhere else, which is the other way
	// a menu closes.
	function items(): HTMLElement[] {
		return menu ? [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')] : [];
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
		aria-label={currentName
			? i18n.m.game.difficultyCurrent(currentName)
			: i18n.m.game.difficultyLabel}
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
		{#if currentName}
			<span
				class="font-condensed hidden text-xs font-bold tracking-widest uppercase sm:inline"
				aria-hidden="true"
			>
				{currentName}
			</span>
		{/if}
	</button>

	{#if open}
		<div
			bind:this={menu}
			id="{uid}-menu"
			role="menu"
			aria-label={i18n.m.game.difficultyLabel}
			class="absolute right-0 z-50 mt-2 w-36 rounded-lg border border-white/10 bg-gray-900 py-1 shadow-2xl"
		>
			{#each options as opt (opt.key)}
				{@const active = value === opt.value}
				<!-- Out of the tab order: within a menu the arrow keys do the moving,
				     and Tab leaves it. -->
				<button
					role="menuitemradio"
					aria-checked={active}
					tabindex="-1"
					onclick={() => {
						onselect(opt.value);
						closeMenu();
					}}
					class="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-white/10 {active
						? 'text-white'
						: 'text-gray-400'}"
				>
					{i18n.m.game.difficulty[opt.key]}
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
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
