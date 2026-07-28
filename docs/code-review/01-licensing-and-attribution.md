# Licensing and attribution

The only finding area with real legal exposure rather than engineering risk. Everything here is
cheap to fix and gets more awkward to fix the more visible the site becomes.

---

<a id="lic-1"></a>

## LIC-1 — Club logos and marks redistributed under MIT

**Priority:** P1 · **Effort:** M

### What

`LICENSE` is MIT, which grants anyone the right to "use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software". The repository root is the scope of
that grant, and the repository contains material the project does not own and cannot license:

- **41 club logos** committed under `src/lib/assets/logos/` — 32 NHL SVGs (`nhl/ANA.svg` through
  `nhl/WSH.svg`), plus `ohl/BRAM.png`, `ohl/NIAG.png`, `pwhl/MIN.png`, `qmjhl/CAP.png`, and five
  WHL club logos. These are registered trademarks of the clubs and their leagues.
- **Team names and brand colours** throughout `src/lib/team-names.ts` and
  `src/lib/team-colors.ts` — 479 lines of brand palettes keyed to club identity.
- **Hotlinked league CDN assets.** `src/lib/logos.ts:47` falls back to the feed's own logo URL,
  and `HockeyCard.svelte:107` renders `player.headshotUrl` directly from
  `assets.nhle.com` / HockeyTech. These are not redistributed, but serving another party's images
  from their bandwidth on a growing site is its own conversation.

Using club marks to identify the club is normal and defensible — that is nominative use, and it
is what every fan site does. The problem is narrower and entirely fixable: the MIT licence
_purports to sublicense them_, which it cannot do.

### Why it matters

A cease-and-desist over a fan project is unlikely. Being unable to point at a file that says
"the MIT licence covers the source code only" is what turns an unlikely problem into an
expensive one. The cost of prevention is one file.

### Action

Add a `NOTICE` file at the repository root stating:

- The MIT licence in `LICENSE` covers the **source code only**.
- Team names, logos, and marks are the property of their respective clubs and leagues, used for
  identification purposes.
- The project is not affiliated with, endorsed by, or sponsored by the NHL, the PWHL, or the CHL
  member leagues.
- Third-party components and their licences — see [LIC-2](#lic-2) for the fonts, and the Lucide
  icons (ISC) inlined at `DifficultyMenu.svelte:41-55` and `:91-103`. That icon already carries
  an attribution comment in the source, which is the right instinct; this formalises it.

Reference the `NOTICE` from `LICENSE` and from `README.md`.

---

<a id="lic-2"></a>

## LIC-2 — OFL font licence does not ship with the fonts

**Priority:** P2 · **Effort:** S

### What

`src/app.css:4-10` imports seven font faces from `@fontsource/inter` and
`@fontsource/barlow-condensed`. Both families are licensed under the **SIL Open Font License
1.1**, which requires that the licence and copyright notice accompany the fonts wherever they
are distributed.

Vite fingerprints the `.woff2` files into the build output and serves them from the app's own
origin. The Fontsource packages ship their licence text in `node_modules`, which is not part of
the deployed artefact — so the built site distributes the fonts without the notice.

This is a genuine, if minor, OFL violation, and the comment at `src/app.css:1-3` shows the
self-hosting was a deliberate choice rather than an accident, so it will persist.

### Action

Copy the SIL OFL 1.1 text and both copyright lines into the repository (e.g.
`static/licenses/OFL.txt`, which the adapter serves as a static asset) and reference them from
`NOTICE`.

---

<a id="lic-3"></a>

## LIC-3 — No non-affiliation disclaimer or data-source attribution

**Priority:** P1 · **Effort:** S

### What

`README.md` describes where the data comes from, but nothing user-facing does. The site renders
club logos and names on every page with no statement of independence.

The app also reads from APIs it has no formal relationship with:

- `https://api-web.nhle.com/v1` (`src/lib/server/leagues/nhl.ts:4`) — undocumented and unofficial.
- `https://lscluster.hockeytech.com/feed/index.php` (`src/lib/server/leagues/hockeytech.ts:8`),
  using API keys hardcoded at `pwhl.ts:8` and `chl.ts:5`.

Those keys being in source is **fine** — both are published by the leagues' own websites, and
the comments at `pwhl.ts:3-4` and `chl.ts:3-4` say so and cite the reference. They are not
secrets and should not be treated as such. The exposure is not the keys; it is that a growing
site is consuming these feeds with no attribution and no stated relationship.

### Action

- Add a short footer or an About link carrying the non-affiliation disclaimer and crediting the
  leagues as the data source.
- Add the same to `README.md` (see also [MAINT-3](./09-maintainability.md#maint-3), which
  rewrites that file anyway).

---

## Done 2026-07-27 — LIC-1, LIC-2, LIC-3

`NOTICE` at the repository root states that MIT covers the source code only, disclaims affiliation
with all five leagues, names the club marks and brand-colour tables as third-party property,
credits both data sources, and records the font and icon licences. `LICENSE` is unchanged;
`README.md` points at `NOTICE` from a rewritten licence section.

The OFL text now ships as `static/licenses/OFL-Inter.txt` and
`static/licenses/OFL-Barlow-Condensed.txt`, copied from the Fontsource packages and served at
`/licenses/…`. That closes LIC-2: the fonts and their licence now travel together.

For LIC-3 the disclaimer went into a site footer in `+layout.svelte`, alongside links to the new
privacy page ([PRIV-1](./10-privacy-and-telemetry.md#priv-1)) and the repository. Both catalogues
carry the wording, so it is disclaimed in French too.

### One deliberate exception

> [!IMPORTANT]
> **The footer is hidden on the game page** (`fillsViewport` in `+layout.svelte`). `RosterGame`
> is `flex-1` and sizes its cards against the height left over, measured at runtime by a
> `ResizeObserver` — so a footer comes straight out of the play area, worst on a phone in
> landscape, which is already the tightest case that layout handles.
>
> The disclaimer is still on every route that leads to a game: the home page listing every team,
> the privacy page, and the error page. If it ever needs to be on the game page too, put it
> behind the roster drawer rather than below the card table.

### Not done

The hotlinked CDN assets noted under LIC-1 are unchanged — headshots still load from
`assets.nhle.com` and HockeyTech at render time. They are not redistributed, so they are not a
licensing problem; serving another party's images from their bandwidth on a growing site is the
separate conversation that finding flagged, and it has not been had.
