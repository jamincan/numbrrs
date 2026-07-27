# Error handling

Paths that are reachable today and have no handling at all. ERR-1 is the most user-visible
finding in the whole review.

---

<a id="err-1"></a>

## ERR-1 — No `+error.svelte` anywhere

**Priority:** P1 · **Effort:** S

### What

The project has no error boundary. There is no `+error.svelte` at any level of `src/routes/`.

Errors are thrown in at least three places that a normal visitor can reach:

- `game/[league]/[team]/+page.server.ts:6` — `error(404, 'League not found')` for an unknown
  league.
- `game/[league]/[team]/+page.server.ts:13` — `error(404, 'Team not found')` for an unknown team
  code.
- Any unmatched URL.

All of them render SvelteKit's built-in fallback: unstyled, no site navigation, no way back, and
always English even for a visitor who arrived on a `/fr` URL. A mistyped or stale shared link —
the most likely way a new visitor arrives at a broken URL — dead-ends.

### Action

Create `src/routes/+error.svelte` rendering `page.status` and `page.error.message` inside the
site chrome, with a link home built via `resolve('/[[lang=locale]]', { lang: i18n.lang })`.

Add the message keys to the `Messages` interface in `src/lib/i18n/messages.ts` and to both
catalogues. The interface is declared explicitly rather than inferred (see the reasoning at
`messages.ts:6-11`), so TypeScript will flag the missing French entries for you — use that.

### The trap

`+layout.svelte:24` calls `createI18n(() => data.locale)`, and `data.locale` comes from
`+layout.server.ts`. On an **unmatched** URL no route exists, so that load never runs and
`data.locale` is `undefined` — every `i18n.m.*` lookup in the layout nav then reads off
`CATALOGUES[undefined]` and throws, turning your error page into a second error.

Guard it: `createI18n(() => data?.locale ?? DEFAULT_LOCALE)`.

`LocaleToggle.svelte:22` already anticipates exactly this case for `page.route.id`
(`page.route.id ?? '/[[lang=locale]]'`, with the comment explaining why) — the same defensive
reasoning applies one level up.

Test both shapes, they take different paths:

- `/game/nhl/ZZZ` — a matched route that throws a 404. Layout loads **do** run.
- `/nonexistent` — an unmatched URL. Layout loads do **not** run.

---

<a id="err-2"></a>

## ERR-2 — No `handleError` hook

**Priority:** P1 · **Effort:** S · **Status:** mostly done as of `ff92fdf`

### What

> [!NOTE]
> **Updated 2026-07-27.** The hook now exists. `src/hooks.server.ts:77-96` exports `handleError`,
> routes through `reportError` so the error reaches both SQLite and Discord, deliberately skips
> 404s (crawler noise would otherwise bury real faults), and returns only `{ message }` — no
> stack, no internals. That is the substance of this finding and it is satisfied. The comment at
> `:69-76` explains the reasoning better than this document originally did.

The original finding, for context: without `handleError` an unexpected server error produced a
generic 500 with nothing correlating it to anything in the logs. On Fly, with
`min_machines_running = 0` and machines cycling, "a user reported a 500 yesterday" was
unactionable.

### What is left

One piece of the original action is still open — the **error ID**:

- Generate an ID in the hook, include it in the stored row, and return it in the shape given to
  the client, so a user saying "I got error a3f9c1" maps to a specific record.
- Surface it in the `+error.svelte` from [ERR-1](#err-1).

There is nowhere to display an ID until that error page exists, so **do this as part of ERR-1**
rather than on its own. `errors.fingerprint` (`db/schema.ts:96`) is not a substitute — it folds
every occurrence of the same bug into one value, so it identifies the defect but not the visit.

### Verified clean

The hook logs `error.message`, `error.stack`, and `event.route.id`. It does not touch cookies,
headers, or the request body, so the "check it does not log secrets" concern is discharged.

---

<a id="err-3"></a>

## ERR-3 — Unguarded `localStorage`

**Priority:** P1 · **Effort:** S

### What

`RosterGame.svelte:46-56` reads and writes `localStorage` with no error handling:

```ts
function savedDifficulty(): number {
	if (!browser) return 2;
	const stored = Number(localStorage.getItem(DIFFICULTY_KEY));
	return DIFFICULTY_OPTIONS.some((o) => o.value === stored) ? stored : 2;
}

let difficulty = $state(savedDifficulty());

$effect(() => {
	localStorage.setItem(DIFFICULTY_KEY, String(difficulty));
});
```

`localStorage.setItem` **throws** when storage is unavailable or full — Safari private browsing
historically, any browser with site data blocked, and iOS Safari under storage pressure. The
throw happens inside a `$effect` during component initialisation, so it does not degrade the
difficulty setting: it breaks the whole game component.

The value handling itself is already careful — the comment at `:44-45` correctly notes that
`Number(junk)` is `NaN` and that the `DIFFICULTY_OPTIONS.some()` check rejects it. Only the
access is unguarded.

### Action

Wrap both the read and the write in `try`/`catch`, falling back to the in-memory default. A
visitor who cannot persist their difficulty should still be able to play.

Worth extracting as a small helper if [MAINT-1](./09-maintainability.md#maint-1) splits this file
— `src/lib/game-state.svelte.ts` is the natural home.

---

<a id="err-4"></a>

## ERR-4 — `migrate()` runs at module import

**Priority:** P2 · **Effort:** S

### What

`src/lib/server/db/index.ts:12-17` runs migrations as a side effect of importing the module:

```ts
if (!building) {
	const client = new Database(env.DATABASE_URL || 'local.db');
	client.pragma('journal_mode = WAL');
	db = drizzle(client, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });
}
```

If a migration fails — a bad SQL file, a locked database, a volume that did not mount — the
throw happens during module evaluation. SvelteKit surfaces that as an opaque 500 on **every**
request, with nothing in the response indicating that the database never came up. The failure
mode is a site that is fully down and looks like an application bug.

There are seven migrations in `drizzle/`, applied on every boot, and the Dockerfile copies that
folder into the production image at line 28 — so this runs in production on every machine start.

### Action

Wrap the initialisation in explicit error handling that logs the failure distinctly ("database
migration failed", with the underlying error) and exits the process rather than serving a broken
app. Fly will restart the machine and the failure will be visible in the logs as a boot failure
rather than as scattered 500s.

Pairs naturally with [TYPE-1](./04-type-safety.md#type-1), which restructures this same
initialisation, and [PERF-3](./07-caching-and-scaling.md#perf-3), which adds the health check
that would surface it.
