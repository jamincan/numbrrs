/**
 * Logos we host ourselves, overriding whatever the league feed reports.
 *
 * Drop a file at `src/lib/assets/logos/<league>/<TEAM_CODE>.<ext>` and it wins
 * automatically — Vite picks it up at build time and fingerprints it, so no
 * registry to update. Use this when a feed logo is unusable, most often because
 * the league publishes a JPG with a baked-in white background instead of a
 * transparent PNG.
 */
const LOCAL_LOGOS: Record<string, string> = Object.fromEntries(
	Object.entries(
		import.meta.glob('./assets/logos/*/*.{png,svg,webp,avif}', {
			eager: true,
			query: '?url',
			import: 'default'
		}) as Record<string, string>
	).map(([path, url]) => {
		const [, league, file] = path.match(/\/logos\/([^/]+)\/([^/]+)$/) ?? [];
		return [logoKey(league, file.replace(/\.[^.]+$/, '')), url];
	})
);

function logoKey(league: string, abbreviation: string): string {
	return `${league.toLowerCase()}:${abbreviation.toUpperCase()}`;
}

/**
 * A logo with a baked-in background can't be drawn straight onto the app's dark
 * surfaces. It can't be blended or knocked out either — plenty of logos contain
 * legitimate white — so the UI sits it on a light chip instead, and skips it
 * where it would be used as a watermark.
 */
function hasOpaqueBackground(logoUrl: string): boolean {
	return /\.jpe?g(\?|$)/i.test(logoUrl);
}

export type TeamLogo = {
	url: string;
	/** True when the image has its own background baked in. */
	opaque: boolean;
};

export function teamLogo(league: string, abbreviation: string, feedUrl: string): TeamLogo {
	const local = LOCAL_LOGOS[logoKey(league, abbreviation)];
	// Anything we host ourselves is only worth adding as a transparent image.
	if (local) return { url: local, opaque: false };
	return { url: feedUrl, opaque: hasOpaqueBackground(feedUrl) };
}
