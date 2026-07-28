import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FeedSchemaError, parseFeed } from './validate';
import { parseRosterEntries, rosterSchema } from './hockeytech';

describe('parseFeed', () => {
	const schema = z.object({
		forwards: z.array(z.object({ firstName: z.object({ default: z.string() }) }))
	});

	it('returns the parsed value when the shape matches', () => {
		const value = { forwards: [{ firstName: { default: 'Auston' } }] };
		expect(parseFeed(schema, value, 'NHL roster')).toEqual(value);
	});

	it('throws a FeedSchemaError, not a plain Error', () => {
		// The distinction is load-bearing: callers retry a network failure and
		// must never retry a schema change.
		expect(() => parseFeed(schema, {}, 'NHL roster')).toThrow(FeedSchemaError);
	});

	it('names the field that moved', () => {
		// The realistic break: a per-language object flattened to a bare string.
		const value = { forwards: [{ firstName: 'Auston' }] };
		expect(() => parseFeed(schema, value, 'NHL roster')).toThrow(
			/NHL roster schema mismatch.*forwards\.0\.firstName/
		);
	});

	it('reports the root when the whole payload is wrong', () => {
		expect(() => parseFeed(schema, 'not json', 'NHL roster')).toThrow(/\(root\)/);
	});

	it('caps the issue list rather than printing every field', () => {
		const wide = z.object({ a: z.string(), b: z.string(), c: z.string(), d: z.string() });
		try {
			parseFeed(wide, {}, 'wide feed');
			expect.unreachable('should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(FeedSchemaError);
			expect((err as Error).message).toMatch(/\(\+1 more\)/);
		}
	});
});

describe('the HockeyTech roster schema is lenient by design', () => {
	// A schema too strict here would empty a team instead of failing loudly,
	// which is the worst of both outcomes — hence pinning the leniency down.

	it('keeps a well-formed roster intact', () => {
		const feed = [
			{ player_id: '1', first_name: 'Sarah', last_name: 'Nurse', active: '1', position: 'LW' }
		];
		const parsed = rosterSchema.parse(feed);
		expect(parseRosterEntries(parsed)).toHaveLength(1);
	});

	it('survives the junk entries and nested coaching arrays the feed appends', () => {
		const feed = [
			{ player_id: '1', last_name: 'Nurse', active: '1' },
			{},
			[{ coach: 'yes' }],
			'unexpected string',
			null,
			42
		];

		const parsed = rosterSchema.parse(feed);
		expect(parsed).toHaveLength(6);

		// Everything unusable collapses to {} and is then filtered by the same
		// logic that already handled it before validation existed.
		const players = parseRosterEntries(parsed);
		expect(players).toHaveLength(1);
		expect(players[0]!.lastName).toBe('Nurse');
	});

	it('keeps unknown fields rather than stripping them', () => {
		const parsed = rosterSchema.parse([{ player_id: '1', last_name: 'Nurse', rookie: 'yes' }]);
		expect(parsed[0]).toHaveProperty('rookie', 'yes');
	});

	it('rejects a roster that is not a list at all', () => {
		// The envelope is the part that must stay strict.
		expect(() => parseFeed(rosterSchema, { Roster: 'nope' }, 'PWHL roster')).toThrow(
			FeedSchemaError
		);
	});
});
