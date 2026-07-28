import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
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
