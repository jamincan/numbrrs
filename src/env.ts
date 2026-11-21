import { defineEnvVars } from '@sveltejs/kit/env';

// All three are read when the server starts (none is `static`), so Fly secrets
// apply without a rebuild, and all three are optional: each one's absence is a
// supported state rather than a misconfiguration.
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
	DATABASE_URL: {
		description: 'SQLite file path. Unset: local.db in the working directory.',
		schema: (input) => input
	}
});
