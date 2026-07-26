// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Locale } from '$lib/i18n';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Resolved from the locale cookie or Accept-Language in hooks.server.ts. */
			locale: Locale;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
