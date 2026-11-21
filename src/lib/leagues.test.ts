import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE, LEAGUE_IDS, resolveLeague } from './leagues';

describe('resolveLeague', () => {
	it('takes the league the URL names over the one the cookie remembers', () => {
		expect(resolveLeague('pwhl', 'ohl')).toBe('pwhl');
		expect(resolveLeague(DEFAULT_LEAGUE, 'ohl')).toBe(DEFAULT_LEAGUE);
	});

	it('falls back to the cookie when the URL names none', () => {
		expect(resolveLeague(null, 'ohl')).toBe('ohl');
		expect(resolveLeague(undefined, 'qmjhl')).toBe('qmjhl');
	});

	it('falls back to the default when neither names one', () => {
		expect(resolveLeague(null, undefined)).toBe(DEFAULT_LEAGUE);
		expect(resolveLeague(undefined, null)).toBe(DEFAULT_LEAGUE);
	});

	it.each(['', 'nope', 'NHL', ' nhl', 'nhl ', 'nhl,pwhl', '__proto__', 'constructor'])(
		'passes over %j as though it were not there',
		(junk) => {
			expect(resolveLeague(junk, 'whl')).toBe('whl');
			expect(resolveLeague(null, junk)).toBe(DEFAULT_LEAGUE);
			expect(resolveLeague(junk, junk)).toBe(DEFAULT_LEAGUE);
		}
	);

	it('only ever answers with a known league', () => {
		for (const param of [...LEAGUE_IDS, 'nope', null]) {
			for (const cookie of [...LEAGUE_IDS, 'nope', undefined]) {
				expect(LEAGUE_IDS).toContain(resolveLeague(param, cookie));
			}
		}
	});
});
