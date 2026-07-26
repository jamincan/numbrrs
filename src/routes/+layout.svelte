<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import LocaleToggle from '$lib/components/LocaleToggle.svelte';
	import NumbrrsIcon from '$lib/components/NumbrrsIcon.svelte';
	import { localizePath } from '$lib/i18n';
	import { createI18n } from '$lib/i18n/state.svelte';
	import { SITE_ORIGIN } from '$lib/site';

	let { children, data } = $props();

	// The URL owns the locale — hooks.server.ts resolves it from the /fr prefix
	// and the layout data carries it here, so switching language is just a
	// navigation. Created per layout instance rather than at module scope so
	// concurrent SSR renders don't share one locale.
	const i18n = createI18n(() => data.locale);

	// The server stamps <html lang> on the first render; client-side
	// navigations between /... and /fr/... have to keep it honest themselves.
	$effect(() => {
		if (browser) document.documentElement.lang = i18n.locale;
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{i18n.m.title}</title>
	<!-- Each language lives at its own URL, so tell search engines how the two
	     relate — and that either host (numbrrs.ca, numbrrs.fly.dev) canonically
	     lives at numbrrs.ca. -->
	<link rel="canonical" href={SITE_ORIGIN + page.url.pathname} />
	<link rel="alternate" hreflang="en" href={SITE_ORIGIN + localizePath(page.url.pathname, 'en')} />
	<link rel="alternate" hreflang="fr" href={SITE_ORIGIN + localizePath(page.url.pathname, 'fr')} />
	<link
		rel="alternate"
		hreflang="x-default"
		href={SITE_ORIGIN + localizePath(page.url.pathname, 'en')}
	/>
</svelte:head>

<nav class="flex items-center justify-between bg-gray-950 px-6 py-3 text-sm text-gray-300">
	<a
		href={resolve('/[[lang=locale]]', { lang: i18n.lang })}
		class="font-condensed flex items-center gap-2 text-lg font-black text-white"
	>
		<NumbrrsIcon class="h-7 w-7" />
		Numbrrs
	</a>
	<div class="flex items-center gap-3">
		<LocaleToggle />
		<a
			href="https://github.com/jamincan/numbrrs"
			target="_blank"
			rel="noopener noreferrer"
			class="text-gray-400 transition-colors hover:text-white"
			aria-label={i18n.m.github}
		>
			<svg
				xmlns="http://www.w3.org/2000/svg"
				width="20"
				height="20"
				viewBox="0 0 24 24"
				fill="currentColor"
			>
				<path
					d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0 1 12 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"
				/>
			</svg>
		</a>
	</div>
</nav>

{@render children()}
