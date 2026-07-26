// The locale is resolved per request in hooks.server.ts; this hands it to the
// root layout so the very first render is already in the right language.
export function load({ locals }) {
	return { locale: locals.locale };
}
