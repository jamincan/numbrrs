import { getContext, setContext } from 'svelte';
import { browser } from '$app/environment';
import { en } from './en';
import { fr } from './fr';
import { LOCALE_COOKIE, LOCALE_MAX_AGE, type Locale } from './index';
import type { Messages } from './messages';

const CATALOGUES: Record<Locale, Messages> = { en, fr };

class I18n {
	#locale: () => Locale;

	/**
	 * The locale is read through a getter rather than copied into local state:
	 * the URL owns it (via hooks → layout data), so switching language is a
	 * navigation and there's no second source of truth to keep in sync.
	 */
	constructor(locale: () => Locale) {
		this.#locale = locale;
	}

	get locale(): Locale {
		return this.#locale();
	}

	/** The active catalogue. Reactive: reading it re-runs when the locale changes. */
	get m(): Messages {
		return CATALOGUES[this.locale];
	}

	/**
	 * The active locale as the [[lang=locale]] route parameter: only non-default
	 * locales appear in URLs, so English is no parameter at all. Spread into
	 * resolve() calls — `resolve('/[[lang=locale]]', { lang: i18n.lang })`.
	 */
	get lang(): 'fr' | undefined {
		return this.locale === 'fr' ? 'fr' : undefined;
	}

	/**
	 * Record an explicit language choice. The cookie doesn't render anything —
	 * the URL does — it only decides whether an unprefixed visit gets redirected
	 * to the French URLs, so a visitor who picked English isn't bounced back by
	 * their browser's Accept-Language.
	 */
	remember(locale: Locale) {
		if (!browser) return;
		document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_MAX_AGE}; samesite=lax`;
	}

	/** `0.85` to "85%" / "85 %" — French wants a narrow no-break space first. */
	percent(ratio: number): string {
		return new Intl.NumberFormat(this.locale, {
			style: 'percent',
			maximumFractionDigits: 0
		}).format(ratio);
	}
}

const KEY = Symbol('i18n');

/**
 * Created per component instance in the root layout, never at module scope: a
 * module-level instance would be shared by every request the server renders
 * concurrently.
 */
export function createI18n(locale: () => Locale): I18n {
	return setContext(KEY, new I18n(locale));
}

export function getI18n(): I18n {
	return getContext<I18n>(KEY);
}
