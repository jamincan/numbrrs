import type { Locale } from '#lib/i18n/index.ts';

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
			/** The language of the URL — French under /fr, English otherwise. Set in hooks.server.ts. */
			locale: Locale;
			/**
			 * Set by a load function whose response must not be shared by a CDN,
			 * overriding the page caching policy in hooks.server.ts.
			 */
			uncacheable?: boolean;
		}
	}
}

export {};
