import { untrack } from 'svelte';

/** `gap-1.5` between option buttons, in px. */
const OPTION_GAP = 6;
/** Narrower than this and a third column stops being worth reading. */
const MIN_OPTION_WIDTH = 150;

/**
 * Where the roster drawer sits and how big it can get. Kept apart from the
 * quiz state because none of it is about hockey — it's measuring boxes on
 * screen, and it would need the same wiring for a completely different game.
 *
 * `cardTable`, `drawerEl` and `optionsBox` are meant to be bound directly from
 * the components that render those elements (`bind:this={layout.cardTable}`),
 * so this class only ever measures what's already reactively wired in.
 */
export class DrawerLayout {
	// The roster lives in one place — the drawer — at every size; only which
	// edge it comes from changes. Landscape has width to spare and no height
	// to spare, so there it becomes a full-height panel down the right side;
	// portrait gets the bottom. That covers desktop too, which is just a wide
	// landscape viewport.
	//
	// The arrangement itself is the stylesheet's doing — the `side` variant in
	// app.css — so it is right in the server's markup, before any of this has
	// run. This is the same answer for the script's benefit: whether the drawer
	// starts open, and what its height is measured against.
	rightDrawer = $state(false);

	// Whether the drawer shows the whole roster or just the current options.
	// Left to the layout until the player says otherwise: a right-hand panel
	// has the height to show everything, which is what the old desktop layout
	// did, while a bottom drawer starts on the options alone so it stays out of
	// the way. An explicit toggle wins from then on.
	#drawerChoice = $state<boolean | null>(null);

	// The drawer sizes itself to its content but never past the room it
	// actually has, so it scrolls internally instead of stretching the page:
	// down to the bottom of the viewport from wherever it starts. As a bottom
	// drawer that means the space under the card table; as a side panel, its
	// own top edge. Without the cap the panel's content would inflate the flex
	// row it sits in and the whole page would scroll.
	drawerMax = $state<number | null>(null);
	viewportWidth = $state(0);

	// Two columns is the default: wider targets, easier to read. Fewer if the
	// drawer is too narrow to hold two (the side panel), more only when the
	// preferred count would overflow the height available: Medium, with ten
	// answers under as many as four headings, on a short viewport.
	optionColumns = $state(2);

	cardTable = $state<HTMLElement>();
	drawerEl = $state<HTMLElement>();
	optionsBox = $state<HTMLElement>();

	get drawerOpen(): boolean {
		return this.#drawerChoice ?? this.rightDrawer;
	}

	toggleDrawer() {
		this.#drawerChoice = !this.drawerOpen;
	}

	measureDrawerSpace() {
		const anchor = this.rightDrawer ? this.drawerEl : this.cardTable;
		if (!anchor) return;
		const box = anchor.getBoundingClientRect();
		const next = Math.max(window.innerHeight - (this.rightDrawer ? box.top : box.bottom + 8), 96);
		// Only on a real change: the ResizeObserver watches the very element this
		// resizes, so an unconditional write would loop. Compared untracked, because
		// the effect that owns that observer calls this: reading the value there
		// would make the effect depend on what it writes, and it would tear the
		// observer down and rebuild it after every measurement that moved.
		if (next !== untrack(() => this.drawerMax)) this.drawerMax = next;
	}

	/**
	 * @param answers The answers the collapsed drawer is currently showing: the
	 * one piece of quiz state the column count needs, and only to know when it
	 * has changed. Passed as a getter rather than a value so reading it here
	 * is what makes this effect depend on it.
	 */
	constructor(answers: () => unknown) {
		$effect(() => {
			// The `side` variant's query, word for word.
			const query = window.matchMedia('(min-width: 600px) and (orientation: landscape)');
			const sync = () => (this.rightDrawer = query.matches);
			sync();
			query.addEventListener('change', sync);
			return () => query.removeEventListener('change', sync);
		});

		// Measured from a ResizeObserver rather than on state changes alone,
		// because swapping between the two arrangements moves the drawer without
		// changing anything reactive — the first measurement would otherwise be
		// taken while the element was still laid out the old way.
		$effect(() => {
			const observer = new ResizeObserver(() => this.measureDrawerSpace());
			if (this.cardTable) observer.observe(this.cardTable);
			if (this.drawerEl) observer.observe(this.drawerEl);
			this.measureDrawerSpace();
			return () => observer.disconnect();
		});

		$effect(() => {
			// Re-measure whenever the answers, the drawer's shape or the viewport
			// changes.
			void [answers(), this.drawerMax, this.viewportWidth, this.drawerOpen, this.rightDrawer];
			const box = this.optionsBox;
			if (!box) return;
			const cells = [...box.querySelectorAll<HTMLElement>('button')];
			if (cells.length === 0) return;
			// Grid rows are as tall as their tallest cell, so a wrapped name sets
			// the height for its whole row. Taking the tallest biases the estimate
			// toward granting an extra column, which is the harmless direction:
			// more columns never needs more height than fewer.
			const rowHeight = Math.max(...cells.map((cell) => cell.offsetHeight));
			const padding = parseFloat(getComputedStyle(box).paddingBottom) || 0;
			// The bottom drawer's whole allowance, less the handle above the grid
			// and the grid's own bottom padding — measured from the budget rather
			// than the box, which only reports how tall the content happens to be
			// when it fits. The side panel is stretched by its flex row, so there
			// its own height already is the space available.
			//
			// The answers are in groups, one to a position, each under a heading:
			// the headings and the gaps between the groups come out of the room
			// the rows have.
			// Both are read off the page, because both are smaller on a phone.
			const headings = [...box.querySelectorAll<HTMLElement>('h2')];
			const px = (value: string) => parseFloat(value) || 0;
			const groupGap = px(
				getComputedStyle(headings[0]?.parentElement?.parentElement ?? box).rowGap
			);
			const overhead =
				headings.reduce(
					(sum, heading) => sum + heading.offsetHeight + px(getComputedStyle(heading).marginBottom),
					0
				) +
				Math.max(0, headings.length - 1) * groupGap;
			const available =
				(this.drawerMax === null ? box.clientHeight : this.drawerMax - box.offsetTop - padding) -
				overhead;
			if (rowHeight <= 0 || available <= 0) return;
			const rowsThatFit = Math.max(
				1,
				Math.floor((available + OPTION_GAP) / (rowHeight + OPTION_GAP))
			);
			const widthAllows = Math.min(
				3,
				Math.max(1, Math.floor((box.clientWidth + OPTION_GAP) / (MIN_OPTION_WIDTH + OPTION_GAP)))
			);
			const preferred = Math.min(2, widthAllows);
			// Each group starts a row of its own, so the rows needed are counted
			// group by group. A button outside any group (the way on from an
			// introduction) has a row to itself.
			const groups = [...box.querySelectorAll<HTMLElement>('[data-answer-group]')].map(
				(group) => group.querySelectorAll('button').length
			);
			const grouped = groups.reduce((sum, count) => sum + count, 0);
			const rowsNeeded =
				groups.reduce((sum, count) => sum + Math.ceil(count / preferred), 0) +
				(cells.length - grouped);
			this.optionColumns = rowsNeeded > rowsThatFit ? widthAllows : preferred;
		});
	}
}
