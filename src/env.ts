import { defineEnvVars } from '@sveltejs/kit/env';

// All of these are read when the server starts (none is `static`), so a Fly
// secret takes effect on the restart that setting it triggers, with no rebuild.
// None is required: each one's absence is a supported state rather than a
// misconfiguration.
export const variables = defineEnvVars({
	ALERT_WEBHOOK_URL: {
		description:
			'Discord webhook for error alerts. Unset or blank: errors are recorded, not posted.',
		schema: (input) => input
	},
	ADMIN_TOKEN: {
		description: 'Bearer secret for /admin. Unset: the admin page reports itself unconfigured.',
		schema: (input) => input
	},
	ADMIN_DIRECT: {
		description:
			'Emergency switch for when Cloudflare is down. 1 or true: numbrrs.fly.dev serves the whole site directly instead of redirecting to numbrrs.app, /admin skips the Cloudflare Access check and needs only the token, and an alert is raised at every boot. Unset: the redirect and the Access check are both on.',
		schema: (input) => input === '1' || input?.toLowerCase() === 'true'
	},
	EDGE_TOKEN: {
		description:
			'Secret shared with the Cloudflare Workers, which send it as a bearer token when they report to the origin. Unset: those reports are refused.',
		schema: (input) => input
	},
	DATABASE_URL: {
		description: 'SQLite file path. Unset: local.db in the working directory.',
		schema: (input) => input
	}
});
