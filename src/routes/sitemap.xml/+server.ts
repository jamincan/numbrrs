import { LOCALES, localizePath } from '$lib/i18n';
import { SITE_ORIGIN } from '$lib/site';
import { db } from '$lib/server/db';
import { teams } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

/**
 * The home page and every team page, in both languages. Built from the
 * database rather than a static list so new teams (and new leagues) show up on
 * their own.
 */
export const GET: RequestHandler = () => {
	const rows = db.select().from(teams).all();
	const paths = ['/', ...rows.map((t) => `/game/${t.league}/${t.abbreviation}`)];

	const urls = paths
		.flatMap((path) => LOCALES.map((locale) => localizePath(path, locale)))
		.map((path) => `\t<url><loc>${SITE_ORIGIN}${path}</loc></url>`);

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
