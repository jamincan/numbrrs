# Maintainability and readability

---

<a id="maint-2"></a>

## MAINT-2 — Some comments narrate history rather than explain the code

**Priority:** P2 · **Effort:** M

### What

The comment quality in this codebase is unusually high — most comments explain _why_ the code is
shaped the way it is, which is the hard and valuable kind. A handful drift into describing _what
changed and why it was changed_, which is git's job. The distinction matters because a reader six
months from now has no idea what the code used to do, so a comment framed around a past state
gives them nothing to act on.

Each of these should state the constraint the current code satisfies, in present tense.

| Location                    | The historical clause                                                                                                | Rewrite toward                                                                                                                                                                                                                                   |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `db/schema.ts:22-23`        | "…so it survives restarts; **the app used to re-sync everything on every boot**"                                     | Drop the clause. "Kept in the database so it survives restarts" already says it.                                                                                                                                                                 |
| `+layout.server.ts:7-9`     | "**locals isn't tracked, so the locals version left the layout data … in the old language until a full reload**"     | Present tense: `locals` is not a tracked dependency, so reading the locale from there would not re-run this load on client-side navigation.                                                                                                      |
| `+layout.svelte:54-56`      | "**that double-counted the nav and left every page scrolling by exactly its height**"                                | Keep the `dvh`-vs-`vh` reasoning, which is a live constraint. State the nav double-count as a rule, not a symptom that was observed.                                                                                                             |
| `hockeytech.ts:71-72`       | "…both come back — **which is why numbers looked duplicated**"                                                       | Drop the clause. The preceding sentence already explains the mechanism completely.                                                                                                                                                               |
| `leagues.ts:35-38`          | "**with localStorage the grid couldn't be server-rendered at all, which also meant crawlers saw a loading message**" | Keep the substance — rejecting localStorage _is_ worth recording — but in present conditional: localStorage is unavailable server-side, so the grid could only render after hydration and crawlers would see a loading message instead of links. |
| `RosterGame.svelte:547-549` | "the drawer **no longer** covers the card that shows it"                                                             | "the drawer does not cover the card that shows it."                                                                                                                                                                                              |

### Do not touch these

> [!WARNING]
> A cleanup sweep through this codebase would destroy more value than it creates. The large
> majority of comments here explain genuine non-obvious constraints that the code cannot state
> itself, and several of them are the only record of a subtle decision.

Explicitly leave alone:

- `server/leagues/types.ts:28-34` — the per-variant documentation on the `RosterResult` union.
  It defines the retry contract.
- `server/leagues/http.ts:1-6` — why the fetch timeout exists, including the second-order
  consequence (a hung job that every later visitor joins). This is exactly the kind of reasoning
  that gets refactored away by someone who does not know it.
- `server/leagues/index.ts:251-254` — why an unknown code with a fresh team list must not trigger
  a refetch. Removing this reintroduces an upstream-hammering path.
- `i18n/state.svelte.ts:63-66` and `nav-slot.svelte.ts:4-10` — why these are context-scoped and
  not module-scope. A module-level instance would leak state between concurrent SSR renders. This
  is a correctness constraint that looks like a style preference.
- `lib/types.ts:1-7` — why row types are duplicated rather than imported from the server module.
- `db/index.ts:21-23` — the compile-time schema assertions.
- Essentially all of the layout reasoning in `RosterGame.svelte` (`:58-61`, `:82-85`, `:172-176`,
  `:182-187`, `:210-214`, `:228-231`, `:243-252`, `:267-269`) and the `.card-slot` sizing maths in
  the `<style>` block at `:589-600`. Dense, but every line is load-bearing and none of it is
  re-derivable from the code.
- The card-front/card-back and animation comments in `HockeyCard.svelte:36-40`.

The rule of thumb: keep it if it explains a constraint, a rejected alternative, or a second-order
consequence. Rewrite it if it only makes sense to someone who saw the previous version.

---

<a id="maint-1"></a>

## MAINT-1 — `RosterGame.svelte` is 638 lines with three separable concerns

**Priority:** P2 · **Effort:** L

### What

`src/routes/[[lang=locale]]/game/[league]/[team]/RosterGame.svelte` is by some distance the
largest file in the project (the next is `team-colors.ts` at 479, which is mostly data). It
carries three things that have nothing to do with each other:

1. **Quiz state** (`:36-166`) — difficulty persistence, the deck/recycle/identified model,
   `guessPlayer`, `initialState`.
2. **Layout measurement** (`:173-265`) — drawer placement, `ResizeObserver` wiring, the
   available-space calculation, and 30 lines of option-column arithmetic. This is the densest
   code in the file and the least related to hockey.
3. **Markup** (`:288-577`) — card table, both drawer arrangements, roster groups, snippets.

It is well-organised for its size and the comments carry it, but it is at the limit of what one
file should hold, and it is the file most likely to need changes as the game grows.

### Action

Split into:

- **`src/lib/game-state.svelte.ts`** — the `GameState` type, `initialState`, `dealt`,
  `guessPlayer`, the `nextKey` counter, and the difficulty persistence (with the `try`/`catch`
  from [ERR-3](./02-error-handling.md#err-3)). This becomes unit-testable alongside the existing
  `game.test.ts`, which already covers the pure functions it builds on.
- **`src/lib/drawer-layout.svelte.ts`** — `rightDrawer`, `drawerMax`, `measureDrawerSpace`, the
  `ResizeObserver` effect, and `optionColumns`.
- **`RosterDrawer.svelte`** — the drawer, its handle, and both the expanded roster and collapsed
  options views.
- **`CardTable.svelte`** — the two card slots, the draw/fly animations, the `sr-only` status
  region, and the game-over summary.

`RosterGame.svelte` then composes them.

Carry every comment across. The layout reasoning in particular is the whole reason this code is
maintainable, and it is the easiest thing to lose in a move.

> [!IMPORTANT]
> Do [TYPE-2](./04-type-safety.md#type-2) first. Enabling `noUncheckedIndexedAccess` produces
> errors in this file; fixing them once here beats fixing them across five files.

---

<a id="maint-3"></a>

## MAINT-3 — `README.md` is stale

**Priority:** P1 · **Effort:** S

### What

The README describes an app that no longer exists. It is the first thing a contributor or a
curious visitor reads, and `README.md:18-23` actively solicits contributions.

- **`:3`** — "covering the NHL and the PWHL". There are **five** leagues: NHL, PWHL, WHL, OHL,
  QMJHL (`src/lib/leagues.ts:9-19`).
- **`:16`** — "(the NHL API and the PWHL's HockeyTech feed)". Four leagues now come through
  HockeyTech (`pwhl.ts`, and all three CHL leagues via `chl.ts`).
- ~~**`:40-42`** — the secrets table documents only `DATABASE_URL`. It omits **`SYNC_TOKEN`**.~~
  **Fixed in `ff92fdf`.** The table now carries both `SYNC_TOKEN` (`:43`) and `ADMIN_TOKEN`
  (`:44`), each with a note on what breaks while it is unset.
- No mention of French/English localisation, which is a substantial feature.
- No mention of `/api/sync` at all.

> [!NOTE]
> **Updated 2026-07-27.** Partially fixed. The secrets table was brought up to date when the
> admin dashboard landed, so the one item with security consequences is done. The league count is
> the visible remainder: `README.md:3` and `:16` still describe a two-league app to every visitor
> who opens the repository.

### Action

Update the remaining items. Add:

- The correct league list at `:3` and the correct data-source sentence at `:16`.
- A localisation note.
- The licence and attribution section from [LIC-1](./01-licensing-and-attribution.md#lic-1) and
  [LIC-3](./01-licensing-and-attribution.md#lic-3).
- The scaling constraint from [PERF-2](./07-caching-and-scaling.md#perf-2).
- A pointer to `docs/` — neither this review nor [`../hosting.md`](../hosting.md) is discoverable
  from the README today.

And remove:

- **The `SYNC_TOKEN` row.** [SEC-5](./06-security-hardening.md#sec-5) deletes that endpoint and
  that secret, leaving `DATABASE_URL` and `ADMIN_TOKEN`. Do this **after** SEC-5, not before.
- Any `/api/sync` documentation — it should not be written and then deleted.

Generation guidance (`openssl rand -hex 32`) still belongs in the README, but attached to
`ADMIN_TOKEN`, which becomes the only secret and now also gates the resync capability. This is
the surviving half of the superseded [ABUSE-3](./05-abuse-resistance.md#abuse-3).

The difficulty table at `:9-12` is still accurate against `RosterGame.svelte:37-42` — leave it.

---

<a id="maint-4"></a>

## MAINT-4 — Duplicated markup, repeated literals, template cruft

**Priority:** P3 · **Effort:** S

### Duplicated option button

`RosterGame.svelte:359-367` (roster grid) and `:561-569` (collapsed options) are the same button
with the same classes and the same inline colour style, differing only in the hover/active
transition. Extract one component. Fold it into
[MAINT-1](#maint-1) if doing both.

### Repeated position-code literal

`RosterGame.svelte:28` and `:33`:

```ts
roster.filter((player) => ['L', 'C', 'R', 'F'].includes(player.positionCode));
// ...
roster.filter((player) => !['L', 'C', 'R', 'F', 'D', 'G'].includes(player.positionCode));
```

The canonical set is already documented at `server/leagues/types.ts:14-18` and typed as
`PositionCode` at `i18n/messages.ts:4`. Hoist named constants beside that type — the second
filter silently depends on being the exact complement of the other three groups, which a shared
constant makes safe.

### Template cruft

- **`eslint.config.js:36-40`** — an empty `rules: {}` block with a placeholder comment
  (`// 'svelte/button-has-type': 'error'`) straight from the SvelteKit template. Delete it.
- **`tsconfig.json:15-19`** — boilerplate comments about extending the generated config. Trim to
  what is actually true of this project.

Both are harmless, and both are the kind of thing that makes a reader wonder what else was left
unconsidered.
