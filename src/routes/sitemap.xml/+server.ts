import { LOCALES, localizePath } from '#lib/i18n/index.ts';
import { SITE_ORIGIN } from '#lib/site.ts';
import { getDb } from '#lib/server/db/index.ts';
import { teams } from '#lib/server/db/schema.ts';
import type { RequestHandler } from './$types';

const XML_ENTITIES: Record<string, string> = {
	'&': '&amp;',
	'<': '&lt;',
	'>': '&gt;',
	'"': '&quot;',
	"'": '&apos;'
};

/**
 * Team codes come from the leagues' feeds, not from this codebase, so they are
 * text to be quoted rather than markup to be trusted: one `&` in an
 * abbreviation would otherwise make the whole sitemap unparseable.
 */
function escapeXml(text: string): string {
	return text.replace(/[&<>"']/g, (char) => XML_ENTITIES[char] ?? char);
}

/**
 * The home page, the rules and privacy pages, and every team page, in both
 * languages.
 * Team pages are built from the database rather than a static list so new teams
 * (and new leagues) show up on their own.
 */
export const GET: RequestHandler = () => {
	const rows = getDb().select().from(teams).all();
	const paths = [
		'/',
		'/how-to-play',
		'/privacy',
		...rows.map((t) => `/game/${t.league}/${t.abbreviation}`)
	];

	const urls = paths
		.flatMap((path) => LOCALES.map((locale) => localizePath(path, locale)))
		.map((path) => `\t<url><loc>${escapeXml(`${SITE_ORIGIN}${path}`)}</loc></url>`);

	const xml = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		...urls,
		'</urlset>',
		''
	].join('\n');

	return new Response(xml, {
		headers: {
			'Content-Type': 'application/xml',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
