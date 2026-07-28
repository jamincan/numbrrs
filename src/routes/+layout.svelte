<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import favicon from '$lib/assets/favicon.svg';
	import LocaleToggle from '$lib/components/LocaleToggle.svelte';
	import NumbrrsIcon from '$lib/components/NumbrrsIcon.svelte';
	import { localeFromPath, localizePath } from '$lib/i18n';
	import { createI18n } from '$lib/i18n/state.svelte';
	import { createNavSlot } from '$lib/nav-slot.svelte';
	import { SITE_ORIGIN } from '$lib/site';

	let { children, data } = $props();

	// Pages can claim a spot in the nav for their own controls (the game page's
	// difficulty menu) via the <NavSlot> component.
	const navSlot = createNavSlot();

	// The URL owns the locale — hooks.server.ts resolves it from the /fr prefix
	// and the layout data carries it here, so switching language is just a
	// navigation. Created per layout instance rather than at module scope so
	// concurrent SSR renders don't share one locale.
	//
	// The fallback is what keeps the error page from erroring: an unmatched URL
	// matches no route, so the layout load never runs and `data` arrives empty.
	// Every i18n.m lookup would then read off CATALOGUES[undefined] and throw,
	// turning a 404 into a 500. LocaleToggle guards page.route.id for the same
	// reason.
	//
	// Falling back to the URL rather than to English, because /fr/nonexistent is
	// still a French visitor and deserves a French 404.
	const i18n = createI18n(() => data?.locale ?? localeFromPath(page.url.pathname));

	// The server stamps <html lang> on the first render; client-side
	// navigations between /... and /fr/... have to keep it honest themselves.
	$effect(() => {
		if (browser) document.documentElement.lang = i18n.locale;
	});

	// Only pages under the locale route exist in both languages. On the others
	// (/admin) both toggle options resolve to the same URL, so the control would
	// sit there looking switchable while doing nothing.
	const localized = $derived(page.route.id?.startsWith('/[[lang=locale]]') ?? false);

	// The game sizes its cards against whatever height is left over, measured at
	// runtime, so anything added below it comes straight out of the play area —
	// worst on a phone in landscape, which is the tightest case the layout
	// already has to handle. The disclaimer it would carry is on every route
	// that leads here, and in NOTICE.
	const fillsViewport = $derived(page.route.id?.includes('/game/') ?? false);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- Each language lives at its own URL, so tell search engines how the two
	     relate — and that every host (numbrrs.app, numbrrs.fly.dev, the retired
	     numbrrs.ca) canonically lives at numbrrs.app. Titles and descriptions
	     are per page. -->
	<link rel="canonical" href={SITE_ORIGIN + page.url.pathname} />
	<link rel="alternate" hreflang="en" href={SITE_ORIGIN + localizePath(page.url.pathname, 'en')} />
	<link rel="alternate" hreflang="fr" href={SITE_ORIGIN + localizePath(page.url.pathname, 'fr')} />
	<link
		rel="alternate"
		hreflang="x-default"
		href={SITE_ORIGIN + localizePath(page.url.pathname, 'en')}
	/>
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Numbrrs" />
	<meta property="og:url" content={SITE_ORIGIN + page.url.pathname} />
	<meta property="og:locale" content={i18n.locale === 'fr' ? 'fr_CA' : 'en_CA'} />
	<meta name="twitter:card" content="summary" />
</svelte:head>

<!-- One viewport-height column: nav plus whatever the page renders. Pages fill
     the rest with flex-1 rather than min-h-screen — min-h-screen double-counts
     the nav against the viewport height, leaving every page scrolling by
     exactly that amount (worse on mobile, where 100vh also ignores the browser
     chrome; dvh doesn't).

     bg-gray-950 lives here rather than on individual pages: the footer sits
     outside any page's own background div, and the privacy and error pages
     never set one at all — their light text was rendering on the browser's
     default white background until this covered the whole column. -->
<div class="flex min-h-dvh flex-col bg-gray-950">
	<nav class="flex items-center justify-between bg-gray-950 px-6 py-3 text-sm text-gray-300">
		<a
			href={resolve('/[[lang=locale]]', { lang: i18n.lang })}
			class="font-condensed flex items-center gap-2 text-lg font-black text-white"
		>
			<NumbrrsIcon class="h-7 w-7" />
			Numbrrs
		</a>
		<div class="flex items-center gap-3">
			{#if navSlot.content}
				{@render navSlot.content()}
			{/if}
			{#if localized}
				<LocaleToggle />
			{/if}
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

	<!-- The pages that show club marks carry the statement that we don't own them
	     and aren't endorsed by anyone; NOTICE has the long form. mt-auto pins it
	     to the bottom on short pages without making it sticky. -->
	{#if !fillsViewport}
		<footer class="mt-auto border-t border-gray-900 px-6 py-6 text-xs text-gray-500">
			<div
				class="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"
			>
				<p class="max-w-prose">{i18n.m.footer.disclaimer}</p>
				<nav class="flex shrink-0 gap-4">
					<a
						href={resolve('/[[lang=locale]]/privacy', { lang: i18n.lang })}
						class="transition-colors hover:text-gray-300">{i18n.m.footer.privacy}</a
					>
					<a
						href="https://github.com/jamincan/numbrrs"
						target="_blank"
						rel="noopener noreferrer"
						class="transition-colors hover:text-gray-300">{i18n.m.footer.source}</a
					>
				</nav>
			</div>
		</footer>
	{/if}
</div>
