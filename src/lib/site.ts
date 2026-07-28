/**
 * Canonical origin for absolute URLs (hreflang, canonical, Open Graph, the
 * sitemap). The app also answers on numbrrs.fly.dev; pointing canonicals here
 * keeps search engines from treating the two hosts as duplicate sites.
 *
 * Moved from numbrrs.ca on 2026-07-28 — easily mistyped as numbers.ca, an
 * unrelated bar's domain. hooks.server.ts 301s the old domain here.
 */
export const SITE_ORIGIN = 'https://numbrrs.app';
