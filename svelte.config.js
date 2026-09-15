import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// Deploys rotate every chunk hash, so a tab left open across one asks for
		// modules that no longer exist and dies on the next lazy import. Polling
		// lets the client notice a new build; +layout.svelte turns that into a
		// reload. Five minutes is well under how long a game sits idle in a tab,
		// and the poll is one request for a few bytes.
		version: { pollInterval: 5 * 60 * 1000 },
		// SvelteKit hashes its own inline scripts to satisfy script-src.
		// unsafe-inline is scoped to style-src-attr only: the team-color theming
		// is inline style attributes throughout, but nothing needs an injected
		// <style> element, so style-src-elem stays at style-src's default of
		// 'self'. Player headshots and feed logos come from the leagues' CDNs,
		// hence the broad img-src.
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self'],
				'style-src-attr': ['unsafe-inline'],
				'font-src': ['self'],
				'img-src': ['self', 'https:', 'data:'],
				'connect-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
