import { describe, expect, it } from 'vitest';
import { variables } from './env.ts';

/** What the app would see for a variable given its raw text, as SvelteKit computes it. */
async function parsed(name: keyof typeof variables, input: string | undefined): Promise<unknown> {
	const result = await variables[name].schema['~standard'].validate(input);
	if (result.issues) throw new Error(`${name} rejected ${JSON.stringify(input)}`);
	return result.value;
}

describe('ADMIN_DIRECT', () => {
	// The switch that turns the Cloudflare Access requirement off. It must take
	// a deliberate value to do that: anything ambiguous leaves the check on.
	it.each(['1', 'true', 'TRUE', 'True', 'tRuE'])('is on for %j', async (input) => {
		expect(await parsed('ADMIN_DIRECT', input)).toBe(true);
	});

	it.each([
		undefined,
		'',
		'0',
		'false',
		'FALSE',
		'no',
		'yes',
		'on',
		'2',
		'11',
		' 1',
		'1 ',
		' true ',
		'true\n',
		'truthy',
		'"true"'
	])('is off for %j', async (input) => {
		expect(await parsed('ADMIN_DIRECT', input)).toBe(false);
	});
});

describe('the other variables', () => {
	it.each(['ALERT_WEBHOOK_URL', 'ADMIN_TOKEN', 'EDGE_TOKEN', 'DATABASE_URL'] as const)(
		'%s is optional and passed through untouched',
		async (name) => {
			expect(await parsed(name, undefined)).toBeUndefined();
			expect(await parsed(name, 'some value')).toBe('some value');
		}
	);
});
