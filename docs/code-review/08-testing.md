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

### Done — landed 2026-07-27

`src/lib/server/leagues/index.test.ts`, 19 tests. All 8 cases above are covered, plus a ninth
added for [ABUSE-2](./05-abuse-resistance.md#abuse-2): a failing sync backs off and a subsequent
call does not re-fetch.

One thing this finding didn't anticipate: **`syncTeamList` and `syncRoster` weren't reachable from
the public API with a fake adapter at all.** `ensureTeams`/`ensureTeam`/`loadRoster` build their
adapter list (`ADAPTERS`, `ADAPTERS_BY_ID`) from the real `nhlAdapter`/`pwhlAdapter`/etc. imports at
module scope — there was no seam to hand them a fake `LeagueAdapter` through. Two fixes, used for
different cases:

- **`syncTeamList`, `syncRoster`, `isFresh`, `once`, and `withTimeout` are now exported.** All five
  already took their dependencies as parameters or had none, so exporting them was the whole
  change — the same reasoning `hockeytech.ts` already used for `pickCurrentSeason` and
  `parseRosterEntries`. Cases 1–5, 7, and 8 call these directly.
- **`vi.mock('./nhl', ...)` etc. replace the real adapters for the ABUSE-2 case and for exercising
  `ensureTeam`/`ensureTeams`/`loadRoster` themselves**, since those three are the only place the
  backoff _gate_ (`backingOff(...)` before `once()` ever runs) lives — `syncTeamList`/`syncRoster`
  don't know about backoff, they just report failure.

Two timing traps worth recording so they don't get reintroduced:

- `ensureTeams()` only awaits the sync jobs for leagues it doesn't already know about
  (`if (!known.has(adapter.id)) blocking.push(job)`); a league with existing teams gets a
  fire-and-forget job. The backoff test for `ensureTeams` deliberately starts from a cold database
  (nothing seeded) so its first call is guaranteed to await the job — otherwise the assertion
  right after `await ensureTeams()` would race a promise the test never awaited.
- The retry-path test (case 8) needs to prove the wait was _capped_, not just that it eventually
  finished. `vi.useFakeTimers()` plus `vi.advanceTimersByTimeAsync(16_000)` — comfortably past the
  15s ceiling but nowhere near the 999s `retryAfter` the fake upstream asked for — is what makes
  that distinction instead of just asserting "resolves eventually."

The module-level `inFlight` map in `leagues/index.ts` is not reset between tests (the module is
imported once for the whole file). This turned out not to matter: every test in the suite awaits
whatever sync it triggers to completion, and `once()`'s `.finally()` always releases the key before
that await resolves — so nothing leaks into the next test. Worth re-checking if a future test ever
fires a sync and deliberately doesn't wait for it.

[ABUSE-4](./05-abuse-resistance.md#abuse-4)'s retention bound lives in `analytics.ts`, not
`leagues/index.ts`, so its test is a separate file: `src/lib/server/analytics.test.ts`. Testing it
against the real thresholds (`MAX_EVENTS = 500_000`) would mean inserting half a million rows
per test, so `pruneEvents` and `deleteOldestEvents` gained an optional `PruneLimits` override —
production calls it with no arguments and gets the real constants; the test passes limits in the
dozens. Same shape as `initDb`/`getDb`: the default path is unchanged, and the seam only exists so
a test can exercise the real logic at a size that runs in milliseconds. Three cases: the age cutoff
runs before the row-count ceiling, the row-count phase trims the lowest ids first, and repeated
calls converge when a single pass can't clear the whole backlog (`pruneMaxRows` chunking).

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

### Done — landed 2026-07-28

All seven cases, in `e2e/` (`home.spec.ts`, `game.spec.ts`, `locale.spec.ts`, `errors.spec.ts`,
`drawer.spec.ts`), run against the production build via `@playwright/test`'s `webServer`, wired
into CI right after the build step as this finding said.

The suite runs against a seeded fixture database (`e2e/seed.ts`), not the real leagues: `DATABASE_URL`
points `webServer` at `e2e/fixture.db`, pre-populated with one team and eleven players and every
league's team-list marked freshly synced, so a cold visit never reaches a real league API. Seeding
is idempotent (open, migrate, clear the three tables, re-insert) rather than delete-then-recreate —
deleting a database file right after closing it isn't reliably immediate on every filesystem, and
this sidesteps the question entirely rather than trying to out-wait it.

**This suite found a real bug, not a test-authoring mistake.** The locale toggle's "switch back to
English from `/fr`" direction silently failed and stayed on `/fr`. Root cause: SvelteKit's
client-side router intercepts a link click on `document` during the capture phase — which always
fires before any listener on the link element itself — and immediately fetches the destination
using whatever cookie is already set. The toggle's own `onclick` (which writes the chosen locale
into `numbrrs_locale`) runs afterward, too late: the fetch for `/` had already gone out carrying the
_previous_ click's cookie value, `hooks.server.ts` saw the stale French cookie and told the
client-side navigation to redirect straight back to `/fr`. Confirmed on the wire — the `__data.json`
request for `/` carried `Cookie: numbrrs_locale=fr` and got back
`{"type":"redirect","location":"/fr"}` — before ever suspecting the test. A real visitor toggling
languages on the home page would hit this identically; it was not a Playwright artifact.

Fixed in `LocaleToggle.svelte` with `data-sveltekit-reload`, forcing a real browser navigation for
these two links instead of SvelteKit's client router. A full navigation runs the `onclick` as part
of the same click event, before the browser's default action (following the link) fires, so the
cookie write always lands before the request that depends on it. The comment at the link explains
the race for whoever finds this again.

Two smaller test-writing traps worth recording: `HockeyCard` renders both card faces at all times
(the flip is a CSS transform, not conditional markup), so a locator for "the number on the drawn
card" needs `.first()` — the back face carries the same text under the player's name once a guess
resolves. And a Playwright text locator matching by substring means `getByText('Defense')` also
matches `HockeyCard`'s "Defenseman" position label; the position-group heading needs `{ exact: true
}`.

133 unit tests and 10 e2e tests pass; lint, check, and build are clean.

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

### Done — landed 2026-07-28

`pnpm audit --audit-level=high` runs after the build step, but with `continue-on-error: true` —
informational rather than blocking. At the time this landed the project already carried 20
existing advisories (2 low, 11 moderate, 7 high), all in build/dev tooling nested under
`@sveltejs/adapter-node` (vite, esbuild, postcss, devalue, kysely, brace-expansion) — none of it
code that runs in the deployed process. `pnpm audit --prod` still surfaces 16 of them, because pnpm
doesn't distinguish "a build-time tool nested under a runtime dependency" from "code that actually
executes in production" — so a blocking check would gate every merge on advisories in vite's own
dev server, which never runs on Fly. Visibility is what this finding asked for; a human still has
to read the output and judge each advisory, which a hard failure would just as easily suppress by
training everyone to `continue-on-error` around the whole step, not just this one.

Dependabot/Renovate was not set up — genuinely a separate decision (recurring PRs vs. a CI check),
left for whoever owns that trade-off.
