# Type safety

The codebase is strict-mode TypeScript and generally well typed. These are the places where the
types claim more than the runtime delivers.

The largest type-safety gap is [VAL-1](./03-external-api-validation.md#val-1), covered
separately.

---

<a id="type-1"></a>

## TYPE-1 — `db` is typed as always-defined but is `undefined` during build

**Priority:** P2 · **Effort:** S

### What

`src/lib/server/db/index.ts:10-17`:

```ts
export let db: ReturnType<typeof drizzle<typeof schema>>;

if (!building) {
	const client = new Database(env.DATABASE_URL || 'local.db');
	client.pragma('journal_mode = WAL');
	db = drizzle(client, { schema });
	migrate(db, { migrationsFolder: resolve('drizzle') });
}
```

The export is declared as always-present but is only assigned when `!building`. During
prerendering and build, `db` is `undefined` while its type insists otherwise — so any module-scope
access at build time is a runtime `TypeError` with no type error to warn you.

The guard is correct in intent: the native SQLite binding should not run during build. The type
is what lies.

### Why it matters now

It also blocks [TEST-1](./08-testing.md#test-1). Testing the sync layer means pointing it at an
in-memory database, which a module-scope `let` bound at import time does not allow.

### Action

Replace the mutable export with an accessor that fails loudly and can be redirected in tests:

- A `getDb()` that throws a clear message ("database accessed during build") rather than
  returning `undefined`, **or**
- An explicit `initDb()` / injectable module singleton that tests can point at
  `new Database(':memory:')`.

Update the call sites: `server/leagues/index.ts` (throughout), `routes/[[lang=locale]]/+page.server.ts:1`,
`routes/sitemap.xml/+server.ts:3`.

> [!NOTE]
> **Keep** the compile-time assertions at `db/index.ts:21-27`:
>
> ```ts
> type Equals<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
> type Expect<T extends true> = T;
> export type _PlayerMatchesSchema = Expect<Equals<Player, typeof schema.players.$inferSelect>>;
> ```
>
> This proves the hand-written types in `$lib/types.ts` stay identical to what the Drizzle schema
> produces, so a component can import row types without dragging server-only code toward the
> client bundle. It is a good pattern, it is load-bearing, and it should survive the refactor
> untouched.

Do this together with [ERR-4](./02-error-handling.md#err-4), which restructures the same
initialisation.

### Done — landed 2026-07-27

`db/index.ts` now exports `initDb(client)` (migrates and sets the module singleton) and
`getDb()` (throws `'Database accessed before initialization'` if called first). Both suggested
shapes from this finding — a throwing accessor and an explicit init a test can point at
`new Database(':memory:')` — turned out to be the same function pair, not a choice between them.

The finding didn't anticipate one thing: **the production bootstrap doesn't live in `db/index.ts`
at all anymore.** It moved to `hooks.server.ts`, guarded by the same `building` check the original
code used:

```ts
if (!building) bootstrap();
```

Reason: `db/index.ts` is imported by every module under test in
[TEST-1](./08-testing.md#test-1) (`leagues/index.ts`, `analytics.ts`). If the real-file bootstrap
had stayed at that module's top level, `building` is `false` under Vitest too — every test run
would have created and migrated a real `local.db` on disk before the test got a chance to call
`initDb(':memory:')` over it. Moving the one-time bootstrap to `hooks.server.ts` (which no test
imports) means the module itself has zero side effects on import; something has to call `initDb`
or `bootstrap` explicitly, which is exactly the property this finding was after.

`bootstrap()` also does [ERR-4](./02-error-handling.md#err-4)'s job: a failed migration logs
`'Database migration failed:'` with the underlying error and calls `process.exit(1)` rather than
leaving `instance` unset for the first request to trip over.

The six call sites all changed the same way: `import { db }` became `import { getDb }`, and each
function that touches the database now opens with `const db = getDb();` (or inlines the call for
a single use). No call site needed to change _how_ it uses `db` — only how it obtains it. Verified
against the built server: `bootstrap()` runs at real startup and `/`, `/sitemap.xml`, and `/admin`
all serve `200`.

The compile-time `Equals`/`Expect` assertions were left untouched, as instructed.

---

<a id="type-2"></a>

## TYPE-2 — `noUncheckedIndexedAccess` is off

**Priority:** P2 · **Effort:** M

### What

`tsconfig.json` sets `strict: true` but not `noUncheckedIndexedAccess`. Without it, indexing an
array or a `Record` yields `T` rather than `T | undefined`, so the compiler cannot see the most
common source of runtime `undefined` in this codebase — and there is a lot of `Record<string, T>`
lookup here (`team-colors.ts`, `team-names.ts`, `logos.ts`, `POSITION_MAP`, `TEAM_NAMES`).

### The latent crash it would catch

`src/lib/logos.ts:17-20`:

```ts
).map(([path, url]) => {
	const [, league, file] = path.match(/\/logos\/([^/]+)\/([^/]+)$/) ?? [];
	return [logoKey(league, file.replace(/\.[^.]+$/, '')), url];
})
```

The `?? []` handles a failed match by producing `undefined` for both `league` and `file` — and
then immediately calls `.toLowerCase()` on one and `.replace()` on the other. This runs at
**module scope**, so a failure is a `TypeError` at import time, taking down every page that
imports `logos.ts` (the home page and both card faces).

It does not fire today: the glob at `:12` only matches `./assets/logos/*/*.{png,svg,webp,avif}`,
so the regex always matches. It is one glob change away from firing, and the `?? []` reads as
defensive code that is not actually defending anything.

### Other sites the flag will surface

- `src/lib/game.ts:59` — `const [player, ...rest] = deck;` after an explicit `deck.length === 0`
  check. Safe in practice; the compiler cannot see it. Needs a narrow or a non-null assertion
  with a comment.
- `src/lib/i18n/index.ts:54` — `Number.parseFloat(quality.split('=')[1])`. Safe, since the
  `.startsWith('q=')` check at `:51` guarantees the split yields two parts.
- `HockeyCard.svelte:22-23` — the `?? [primaryColor, primaryColor]` fallbacks widen the
  `[string, string]` tuple to `string[]`, so `lightGradient[0]` becomes possibly-undefined.
  Annotating the fallbacks as tuples fixes it.
- `nhl.ts:167` — `TEAM_NAMES[code] || code`, already defensive; becomes type-correct.

### Action

Enable the flag in `tsconfig.json`, run `pnpm run check`, and work through the results. Each one
is a genuine possibly-undefined; resolve them by narrowing rather than by asserting, except where
a comment can justify the assertion.

> [!IMPORTANT]
> Do this **before** [MAINT-1](./09-maintainability.md#maint-1). `RosterGame.svelte` will produce
> several of these errors, and fixing them in one 638-line file is easier than fixing them across
> the five files MAINT-1 splits it into.

---

<a id="type-3"></a>

## TYPE-3 — `Accept-Language: fr;q=0` resolves to French

**Priority:** P3 · **Effort:** S

### What

`src/lib/i18n/index.ts:44-65` parses quality values but does not handle `q=0`, which per
RFC 9110 §12.5.4 means _explicitly not acceptable_ — the one unambiguous way a client can say
"do not give me this language".

```ts
.filter((entry) => entry.tag !== '' && !Number.isNaN(entry.q))
.sort((a, b) => b.q - a.q);
```

`NaN` is filtered; `0` is not. So `Accept-Language: fr;q=0` sorts `fr` first among one entry and
returns French — the opposite of what was asked. A visitor with that header is redirected to
`/fr` by `hooks.server.ts:27-35`.

Low impact: browsers rarely send `q=0` unprompted, and the locale cookie takes precedence
(`negotiateLocale`, `:72-78`). Still wrong, and a one-character fix.

### Action

Change the filter to `entry.q > 0`, and add a case to the `parseAcceptLanguage` block in
`src/lib/i18n/index.test.ts` — it already has thorough coverage at `:19-55` including malformed
input, so this slots straight in.

### Not recommended: replacing this with a library

`negotiator` or `@formatjs/intl-localematcher` would be the usual advice. It is not worth it
here: the parser is 20 lines, handles quality ordering and primary-subtag matching correctly,
has real test coverage, and serves exactly two locales. Fix the `q=0` case and leave it.
