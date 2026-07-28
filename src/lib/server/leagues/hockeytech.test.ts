import { describe, expect, it, vi } from 'vitest';
import {
	parseRosterEntries,
	pickCurrentSeason,
	type HockeyTechRosterEntry,
	type HockeyTechSeason
} from './hockeytech';

function season(overrides: Partial<HockeyTechSeason>): HockeyTechSeason {
	return {
		season_id: '1',
		season_name: 'Season',
		career: '1',
		playoff: '0',
		start_date: '2025-09-01',
		end_date: '2026-04-30',
		...overrides
	};
}

describe('pickCurrentSeason', () => {
	it('picks the most recent regular season that has started', () => {
		const seasons = [
			season({ season_id: 'old', start_date: '2024-09-20' }),
			season({ season_id: 'current', start_date: '2025-09-18' }),
			season({ season_id: 'future', start_date: '2026-09-17' })
		];
		expect(pickCurrentSeason(seasons, '2026-01-15')?.season_id).toBe('current');
	});

	it('ignores playoff and non-career seasons', () => {
		const seasons = [
			season({ season_id: 'playoffs', playoff: '1', start_date: '2026-05-01' }),
			season({ season_id: 'preseason', career: '0', start_date: '2025-09-01' }),
			season({ season_id: 'regular', start_date: '2025-08-20' })
		];
		expect(pickCurrentSeason(seasons, '2026-06-01')?.season_id).toBe('regular');
	});

	it('keeps last season during the offseason', () => {
		const seasons = [
			season({ season_id: 'last', start_date: '2024-09-20' }),
			season({ season_id: 'next', start_date: '2025-09-18' })
		];
		expect(pickCurrentSeason(seasons, '2025-07-01')?.season_id).toBe('last');
	});

	it('returns undefined when no season has started', () => {
		expect(pickCurrentSeason([season({ start_date: '2099-01-01' })], '2026-01-01')).toBeUndefined();
		expect(pickCurrentSeason([], '2026-01-01')).toBeUndefined();
	});
});

function entry(overrides: Partial<HockeyTechRosterEntry>): HockeyTechRosterEntry {
	return {
		player_id: '100',
		first_name: 'Jane',
		last_name: 'Doe',
		tp_jersey_number: '17',
		position: 'C',
		player_image: 'https://example.com/jane.jpg',
		active: '1',
		...overrides
	};
}

describe('parseRosterEntries', () => {
	it('parses a well-formed entry', () => {
		expect(parseRosterEntries([entry({})])).toEqual([
			{
				id: 100,
				firstName: 'Jane',
				lastName: 'Doe',
				sweaterNumber: 17,
				positionCode: 'C',
				headshotUrl: 'https://example.com/jane.jpg'
			}
		]);
	});

	it('keeps only active players when the feed marks any', () => {
		const players = parseRosterEntries([
			entry({ player_id: '1', active: '1' }),
			entry({ player_id: '2', active: '0' })
		]);
		expect(players.map((p) => p.id)).toEqual([1]);
	});

	it('keeps everyone when the feed reports nobody active, and says so', () => {
		const onNobodyActive = vi.fn();
		const players = parseRosterEntries(
			[entry({ player_id: '1', active: '0' }), entry({ player_id: '2', active: '0' })],
			onNobodyActive
		);
		expect(players.map((p) => p.id)).toEqual([1, 2]);
		expect(onNobodyActive).toHaveBeenCalledOnce();
	});

	it('skips junk entries without player data', () => {
		const players = parseRosterEntries([
			entry({}),
			{ active: '1' },
			entry({ player_id: 'not-a-number' }),
			entry({ last_name: undefined })
		]);
		expect(players).toHaveLength(1);
	});

	it('stores a missing jersey number as null', () => {
		expect(
			parseRosterEntries([entry({ tp_jersey_number: undefined })])[0]!.sweaterNumber
		).toBeNull();
		expect(parseRosterEntries([entry({ tp_jersey_number: '' })])[0]!.sweaterNumber).toBeNull();
	});

	it('normalizes handed positions and passes unknown ones through', () => {
		expect(parseRosterEntries([entry({ position: 'LD' })])[0]!.positionCode).toBe('D');
		expect(parseRosterEntries([entry({ position: 'RW' })])[0]!.positionCode).toBe('R');
		expect(parseRosterEntries([entry({ position: 'HC' })])[0]!.positionCode).toBe('HC');
	});

	it('defaults missing name and image fields', () => {
		const p = parseRosterEntries([entry({ first_name: undefined, player_image: undefined })])[0]!;
		expect(p.firstName).toBe('');
		expect(p.headshotUrl).toBe('');
	});
});
