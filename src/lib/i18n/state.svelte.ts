import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';
import { en } from './en';
import { fr } from './fr';
import { LOCALE_COOKIE, LOCALE_MAX_AGE, type Locale } from './index';
import type { Messages } from './messages';

const CATALOGUES: Record<Locale, Messages> = { en, fr };

class I18n {
	#locale = $state<Locale>('en');

	constructor(initial: Locale) {
		this.#locale = initial;
	}

	get locale(): Locale {
		return this.#locale;
	}

	/** The active catalogue. Reactive: reading it re-runs when the locale changes. */
	get m(): Messages {
		return CATALOGUES[this.#locale];
	}

	/**
	 * Both catalogues are in the bundle, so switching is instant and needs no
	 * round trip. The cookie exists purely so the *next* request renders in the
	 * right language server-side.
	 */
	setLocale(locale: Locale) {
		this.#locale = locale;
		if (!browser) return;
		document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_MAX_AGE}; samesite=lax`;
		document.documentElement.lang = locale;
	}

	/** `0.85` to "85%" / "85 %" — French wants a narrow no-break space first. */
	percent(ratio: number): string {
		return new Intl.NumberFormat(this.#locale, {
			style: 'percent',
			maximumFractionDigits: 0
		}).format(ratio);
	}
}

const KEY = Symbol('i18n');

/**
 * Created per component instance in the root layout, never at module scope: a
 * module-level rune would be shared by every request the server renders
 * concurrently, so one visitor switching to French would flip the language for
 * everyone mid-render.
 */
export function createI18n(initial: Locale): I18n {
	return setContext(KEY, new I18n(initial));
}

export function getI18n(): I18n {
	return getContext<I18n>(KEY);
}
