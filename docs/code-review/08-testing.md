# Testing

## Current coverage

Three test files, all good, all covering pure functions:

- `src/lib/game.test.ts` (140 lines) — shuffle, deck building, draw/recycle, option generation.
- `src/lib/i18n/index.test.ts` (93 lines) — locale matching, `Accept-Language` parsing including
  malformed input, path localisation, negotiation precedence.
- `src/lib/server/leagues/hockeytech.test.ts` (127 lines) — season selection and roster entry
  parsing.

The functions under test were deliberately written to be testable — `game.ts:1-4` notes the quiz
logic is "kept out of the component so it can be unit tested", with injectable randomness, and
`pickCurrentSeason` / `parseRosterEntries` are exported from `hockeytech.ts` for the same reason.
That instinct is right and the coverage of those units is solid.

The gap is everything with side effects.

---

<a id="test-1"></a>

## TEST-1 — The only code that deletes rows has zero tests

**Priority:** P1 · **Effort:** L

### What

`src/lib/server/leagues/index.ts` is 320 lines, the most complex file in the project, and the
only place in the codebase that issues `DELETE`. It has no tests.

Two deletion sites:

**`syncTeamList:115-120`** — removes teams and their players when a league stops reporting them:

```ts
tx.delete(players)
	.where(and(eq(players.league, adapter.id), notInArray(players.teamId, activeIds)))
	.run();
tx.delete(teams)
	.where(and(eq(teams.league, adapter.id), notInArray(teams.id, activeIds)))
	.run();
```

**`syncRoster:177-183`** — removes players no longer on a roster:

```ts
tx.delete(players)
	.where(
		rosterIds.length > 0
			? and(eq(players.teamId, dbId), notInArray(players.id, rosterIds))
			: eq(players.teamId, dbId)
	)
	.run();
```

The reasoning behind both is careful and the comments are good. That is exactly why it needs
tests — the correctness lives in conditions that are easy to break during a refactor and produce
silent data loss rather than an error.

### Cases worth covering

1. **The empty-response guard** (`:86-90`). A league returning `[]` must **not** wipe its teams.
   This is the single most destructive possible failure and it is currently protected by four
   lines and a comment.
2. **Roster deletion is scoped to `teamId`** (`:180`). A player traded to another team must not
   be deleted by their old team's sync — the comment at `:174-176` states this invariant
   explicitly, and nothing enforces it.
3. **The `rosterIds.length === 0` branch** (`:181`). An empty roster clears that team's players.
   Verify it does not clear anyone else's — this branch drops the `notInArray` guard entirely.
4. **Cross-league isolation.** Player IDs are only unique within a league (`db/schema.ts:32-33`),
   so `(league, id)` is the composite key. Confirm a PWHL player with the same numeric ID as an
   NHL player survives an NHL sync.
5. **Freshness** — `isFresh` (`:73-75`) at TTL boundaries, and that `markSynced` is not called on
   a failed sync (which is the [ABUSE-2](./05-abuse-resistance.md#abuse-2) behaviour; lock in
   whichever semantics you land on).
6. **`once()` coalescing** (`:50-59`) — concurrent callers join one job; the key is released
   afterwards; a rejected job does not poison later calls.
7. **`withTimeout`** (`:61-63`) — returns stale data rather than hanging when a sync exceeds
   `BLOCKING_TIMEOUT`.
8. **The retry path** in `syncRoster:130-136` — one retry on `'transient'`, none on
   `'not-found'`, and `MAX_RETRY_DELAY` capping an upstream `Retry-After`.

### Prerequisite

Needs [TYPE-1](./04-type-safety.md#type-1). The `db` export is currently bound at module import
(`db/index.ts:10-17`), so there is no way to point the sync layer at a test database. Make it
injectable first.

### Setup

`new Database(':memory:')` plus `migrate()` against the existing `drizzle/` folder gives a real
schema with real constraints — including the foreign key from `players.teamId` to `teams.id`
(`db/schema.ts:36-38`), which is part of what makes the deletion ordering matter. Fake adapters
implementing `LeagueAdapter` cover the upstream side with no network.

---

<a id="test-2"></a>

## TEST-2 — No end-to-end tests

**Priority:** P2 · **Effort:** L

### What

No browser-level tests exist. The game is the product, and nothing verifies it is playable.

Several behaviours are only expressible end-to-end: the streamed roster promise
(`game/[league]/[team]/+page.svelte:32-59`), the card flip and its two-frame
`requestAnimationFrame` dance (`RosterGame.svelte:270-285`), the drawer's `ResizeObserver`
measurement (`:201-221`), and the option-column calculation (`:234-265`) — which is 30 lines of
layout arithmetic with no coverage at all.

### Action

Add Playwright with a focused suite:

- Home page renders team tiles; league tabs switch and persist across a reload.
- A team page reaches a playable state with a card showing a number.
- A correct guess marks the player identified; an incorrect one does not.
- Difficulty change mid-game re-deals options without changing the drawn card
  (`RosterGame.svelte:299-312`).
- The locale toggle navigates to `/fr` and back, and `<html lang>` follows
  (`+layout.svelte:28-30`).
- A bogus team code renders the error page from [ERR-1](./02-error-handling.md#err-1) — in both
  languages.
- The drawer in both portrait and landscape, since `:173-180` swaps the whole layout on a media
  query.

Add to `.github/workflows/ci.yml` after the build step.

---

<a id="test-3"></a>

## TEST-3 — CI has no dependency audit

**Priority:** P3 · **Effort:** S

### What

`.github/workflows/ci.yml` runs lint, check, test, and build on every push and PR — a good
baseline, correctly using `--frozen-lockfile`. It has no dependency vulnerability check.

### Action

Add a `pnpm audit` step. Consider Dependabot or Renovate for update PRs.

Once [TEST-1](#test-1) lands, a coverage threshold on `src/lib/server/` would be worth adding —
that is where the destructive code lives.
