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
