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
			'Emergency switch for when Cloudflare is down. 1 or true: /admin skips the Cloudflare Access check and needs only the token. Unset: Access is required.',
		schema: (input) => input === '1' || input?.toLowerCase() === 'true'
	},
	DATABASE_URL: {
		description: 'SQLite file path. Unset: local.db in the working directory.',
		schema: (input) => input
	}
});
