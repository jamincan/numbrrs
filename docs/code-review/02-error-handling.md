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

### The trap — real, but not quite as described

This finding predicted that on an unmatched URL the layout load would not run, leaving
`data.locale` undefined and every `i18n.m.*` lookup reading off `CATALOGUES[undefined]`.

**The load does run.** What it does not get is `params.lang`, because there are no params without
a matched route — so it returned `DEFAULT_LOCALE` and the page rendered in English. No crash, but
the exact user-facing bug this finding set out to fix: a French visitor on `/fr/nonexistent`
getting an English 404.

The fix is therefore a locale fallback rather than a null guard, and it belongs in
`+layout.server.ts` rather than the component:

```ts
export function load({ params, url }) {
	return { locale: isLocale(params.lang) ? params.lang : localeFromPath(url.pathname) };
}
```

`localeFromPath` was added to `$lib/i18n` as the inverse of `localizePath`, sharing its prefix
rule so the two cannot drift. `hooks.server.ts` uses it too, so `<html lang>` and the recorded
analytics locale agree with the rendered page. The `data?.locale ?? …` guard in `+layout.svelte`
stays as belt and braces.

`LocaleToggle.svelte:22` already anticipates this case for `page.route.id`
(`page.route.id ?? '/[[lang=locale]]'`, with the comment explaining why) — the same defensive
reasoning applies one level up.

Both shapes verified against the built server, since they take different paths:

| URL                   | Status | `<html lang>` | Title            |
| --------------------- | ------ | ------------- | ---------------- |
| `/game/nhl/ZZZ`       | 404    | `en`          | Page not found   |
| `/fr/game/nhl/ZZZ`    | 404    | `fr`          | Page introuvable |
| `/nonexistent`        | 404    | `en`          | Page not found   |
| `/fr/nonexistent`     | 404    | `fr`          | Page introuvable |
| `/fr/some/deep/bogus` | 404    | `fr`          | Page introuvable |

> [!WARNING]
> The first run of this test reported `/fr/nonexistent` as English **after** the fix was in
> place. The build had silently failed — a previous smoke server still held the output files
> open — so the server was running stale code. If a verification result contradicts a change you
> just made, confirm the build actually succeeded before believing it.

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

### The error ID — done, but not the way this finding proposed

`reportError` now **returns the fingerprint**, and `handleError` passes it through as
`{ message, id }`, declared on `App.Error` in `app.d.ts`. The error page renders it as a
"Reference".

This document originally said `errors.fingerprint` was "not a substitute" for a per-occurrence
ID, because it folds every occurrence of the same bug into one value. On reflection that folding
is the feature, not the obstacle:

- It points at **exactly one row** in the `errors` table, which the dashboard already lists with
  a count, a first-seen and a last-seen. A random per-occurrence ID would need its own column and
  would still have to be looked up by hand.
- Two people reporting the same reference is **information** — it says one bug is hitting several
  visitors, which a unique-per-visit ID would hide.
- It is computed before the database write, so it comes back even when the database is the thing
  that is broken.

What it genuinely does not do is identify a particular visit. If that is ever needed, the count
and timestamps on the row are the place to look first.

Verified against the built server with a temporary throwing route: the page rendered
`Référence: c22b4b15d2b7a691` and the log line read
`[server] /[[lang=locale]]/zzthrowtest (c22b4b15d2b7a691): deliberate smoke-test failure` — the
same value in both places, which is the whole point.

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

### Done — landed 2026-07-27

Landed together with TYPE-1, as predicted. `db/index.ts`'s `bootstrap()` wraps `initDb(...)` in a
try/catch, logs `'Database migration failed:'` with the underlying error, and calls
`process.exit(1)` rather than leaving the database unset for the first request to discover. See
[TYPE-1's Done section](./04-type-safety.md#type-1) for where that call now lives and why
(`hooks.server.ts`, not `db/index.ts`'s own module scope).
