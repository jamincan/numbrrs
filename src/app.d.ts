// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { Locale } from '$lib/i18n';

declare global {
	namespace App {
		interface Error {
			message: string;
			/**
			 * The fingerprint of the recorded error, shown on the error page so a
			 * visitor can quote it. Absent on 404s, which aren't recorded, and on
			 * errors thrown during client-side navigation.
			 */
			id?: string;
		}
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
