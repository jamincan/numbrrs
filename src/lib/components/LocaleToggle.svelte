<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { LOCALES, type Locale } from '$lib/i18n';
	import { getI18n } from '$lib/i18n/state.svelte';

	const i18n = getI18n();

	// resolve()'s typed overloads want a literal route id; this link is built
	// from whatever route is current, so the types can't help here.
	const resolveRoute = resolve as (route: string, params?: Record<string, string>) => string;

	/**
	 * The current page in another language: same route, same params, different
	 * lang. The route id is only null on unrouted 404s, where the toggle isn't
	 * rendered anyway — fall back to the home page there.
	 */
	function localized(locale: Locale): string {
		const params = { ...page.params };
		if (locale === 'fr') params.lang = 'fr';
		else delete params.lang;
		return resolveRoute(page.route.id ?? '/[[lang=locale]]', params);
	}
</script>

<!-- Links, not buttons: each language lives at its own URL, so switching is a
     navigation. The cookie written on click only stops the Accept-Language
     redirect from overriding an explicit choice on the next visit.

     data-sveltekit-reload forces a real browser navigation rather than
     SvelteKit's client-side router. That router intercepts the click on
     `document` during the capture phase, ahead of this element's own onclick,
     and immediately fetches the destination using whatever cookie is already
     set — so switching from /fr back to / raced the cookie write below and
     lost: hooks.server.ts saw the stale French cookie and redirected the
     client-side navigation straight back to /fr. A full navigation runs this
     onclick as part of the same click event, before the browser's default
     action (following the link) fires, so the cookie is written first. -->
<div
	class="flex items-center rounded-md border border-white/10 bg-white/5 p-0.5"
	role="group"
	aria-label={i18n.m.language}
>
	{#each LOCALES as locale (locale)}
		<!-- eslint-disable svelte/no-navigation-without-resolve -- localized() is resolve(), aliased above to accept a dynamic route id -->
		<a
			href={localized(locale) + page.url.search}
			data-sveltekit-reload
			onclick={() => i18n.remember(locale)}
			aria-current={i18n.locale === locale ? 'true' : undefined}
			class="font-condensed rounded px-2 py-0.5 text-xs font-bold tracking-widest uppercase transition-colors {i18n.locale ===
			locale
				? 'bg-white/15 text-white'
				: 'text-gray-500 hover:text-gray-300'}"
		>
			{locale}
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/each}
</div>
