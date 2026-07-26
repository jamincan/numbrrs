import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// SvelteKit hashes its own inline scripts to satisfy script-src.
		// unsafe-inline styles stay: the team-color theming is inline style
		// attributes throughout. Player headshots and feed logos come from the
		// leagues' CDNs, hence the broad img-src.
		csp: {
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
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
