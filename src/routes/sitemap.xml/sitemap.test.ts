import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb } from '#lib/server/db/index.ts';
import { teams } from '#lib/server/db/schema.ts';
import { GET } from './+server.ts';

function addTeam(league: string, abbreviation: string): void {
	getDb()
		.insert(teams)
		.values({
			id: `${league}:${abbreviation}`,
			league,
			name: `Team ${abbreviation}`,
			abbreviation,
			logoUrl: 'https://example.invalid/logo.svg'
		})
		.run();
}

async function sitemap(): Promise<string> {
	const response = await GET({} as Parameters<typeof GET>[0]);
	return response.text();
}

const locs = (xml: string) => [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);

beforeEach(() => {
	initDb(new Database(':memory:'));
});

describe('sitemap.xml', () => {
	it('lists the fixed pages and every team, in both languages', async () => {
		addTeam('nhl', 'TOR');

		expect(locs(await sitemap())).toEqual([
			'https://numbrrs.app/',
			'https://numbrrs.app/fr',
			'https://numbrrs.app/privacy',
			'https://numbrrs.app/fr/privacy',
			'https://numbrrs.app/game/nhl/TOR',
			'https://numbrrs.app/fr/game/nhl/TOR'
		]);
	});

	it('quotes a team code from a feed instead of trusting it as markup', async () => {
		// Codes are whatever a league's feed says they are. One that carries XML
		// syntax must come out as text, not break the document or add to it.
		addTeam('ohl', 'A&W');
		addTeam('ohl', '</loc><loc>https://example.com/');
		addTeam('ohl', `Q"'`);

		const xml = await sitemap();

		expect(xml).toContain('<loc>https://numbrrs.app/game/ohl/A&amp;W</loc>');
		expect(xml).toContain(
			'<loc>https://numbrrs.app/game/ohl/&lt;/loc&gt;&lt;loc&gt;https://example.com/</loc>'
		);
		expect(xml).toContain('<loc>https://numbrrs.app/game/ohl/Q&quot;&apos;</loc>');
		// Two fixed pages and three teams, each in two languages, and nothing more.
		expect(locs(xml)).toHaveLength(10);
		expect(xml).not.toMatch(/&(?!(amp|lt|gt|quot|apos);)/);
	});
});
