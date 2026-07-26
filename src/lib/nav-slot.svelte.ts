import { getContext, setContext } from 'svelte';
import type { Snippet } from 'svelte';

/**
 * A slot in the site nav that the current page can claim for its own controls
 * (the game page puts its difficulty menu there). Pages register through the
 * <NavSlot> component rather than writing to this directly; the layout renders
 * whatever is registered. Context-scoped, not module-level, for the same
 * reason as the i18n store: concurrent SSR renders must not share state.
 */
class NavSlot {
	content = $state<Snippet | null>(null);
}

const KEY = Symbol('nav-slot');

export function createNavSlot(): NavSlot {
	return setContext(KEY, new NavSlot());
}

export function getNavSlot(): NavSlot {
	return getContext<NavSlot>(KEY);
}
