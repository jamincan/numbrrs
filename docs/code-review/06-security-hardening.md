# Security hardening

## First, what is not wrong

Stated up front so nobody spends an afternoon looking for a problem that isn't there.

**The authentication is correct.** Quoted below from `api/sync/+server.ts:12-16` as it stood at
`631b649`. It has since moved to `src/lib/server/admin.ts:15-19` and is now shared by both auth
paths — the assessment is unchanged, and `/api/sync` is being removed by [SEC-5](#sec-5) anyway:

```ts
function tokenMatches(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
```

This is the right implementation. It uses `timingSafeEqual`, it handles the length-mismatch case
that would otherwise make `timingSafeEqual` throw, and the comment at `:7-11` correctly reasons
that leaking the token's length is not worth defending against. It compares the entire
`Authorization` header value against `Bearer ${token}` rather than parsing the header first,
which sidesteps a whole class of parser-mismatch bugs. There is nothing to fix here.

**An auth library would be overhead — today.** There are no user accounts, no sessions, no
password storage, and no user-supplied data persisted anywhere. Adding Auth.js or Lucia would
introduce a dependency, a session store, and a migration surface in exchange for nothing. The
one-token model is proportionate.

> [!NOTE]
> **Re-evaluated 2026-07-27 and the conclusion holds — decision recorded.** The dashboard landed
> with sessions and a login form, which is what this paragraph said would reopen the question. It
> was reopened and closed the other way: Lucia is no longer a library, Oslo is a primitives
> package that would wrap `node:crypto` rather than replace it, and `better-auth` and Auth.js both
> model user accounts this app does not have. `src/lib/server/admin.ts` was reviewed directly and
> is sound. **Staying hand-rolled.** Full reasoning in
> [the re-review](./README.md#re-review-resolved-2026-07-27); the two things that raise confidence
> here are [ABUSE-1](./05-abuse-resistance.md#abuse-1) and extending `admin.test.ts`.

**Other things already done right:** SQL is fully parameterised through Drizzle with no raw
string interpolation anywhere; `hooks.server.ts:49-54` already sets `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` and HSTS; `frame-ancestors: 'none'` covers clickjacking
without needing `X-Frame-Options`; server-only code is properly isolated behind `$lib/server`,
and `types.ts:1-7` explains the deliberate type duplication that keeps the native SQLite binding
away from the client bundle.

The remaining items are genuine but small.

---

<a id="sec-1"></a>

## SEC-1 — `style-src` concession is broader than it needs to be

**Priority:** P2 · **Effort:** S

### What

`svelte.config.js:11-23` sets a real, well-considered CSP. One directive is looser than
necessary:

```js
'style-src': ['self', 'unsafe-inline'],
```

The comment at `:7-10` explains why: team-colour theming uses inline `style` attributes
throughout (`+page.svelte:98-99`, `HockeyCard.svelte:49`, `RosterGame.svelte:362-363`, and
others). That is accurate — those attributes genuinely need the concession.

But inline `style` **attributes** are governed by `style-src-attr`, and inline `<style>`
**elements** by `style-src-elem`; each falls back to `style-src` only when unset. Setting them
separately keeps `unsafe-inline` where it is actually required and denies injected `<style>`
blocks:

```js
'style-src': ['self'],
'style-src-attr': ['unsafe-inline'],
```

SvelteKit's `csp.directives` supports both.

### Test this before shipping

`style-src-attr` is CSP Level 3. A browser that does not support it ignores the directive and
falls back to `style-src: 'self'` — which would block every inline style attribute and strip all
team colouring from the site. Support is broad as of 2026 (Chrome 75+, Safari 15.4+, Firefox
123+), but this is a change that fails _visually and silently_ on older clients rather than
throwing. Verify against the built output and an older browser before deploying.

### While you are in this file

`'img-src': ['self', 'https:', 'data:']` allows images from any HTTPS origin. The comment
explains it covers league CDNs, which is true — headshots come from `assets.nhle.com` and logos
from HockeyTech. Narrowing to those specific hosts would be tighter, at the cost of a code change
whenever a league moves its CDN. A reasonable trade either way; worth a deliberate decision
rather than leaving it as a default.

---

<a id="sec-2"></a>

## SEC-2 — No `Cross-Origin-Opener-Policy`

**Priority:** P3 · **Effort:** S

### What

`hooks.server.ts:49-54` sets four security headers but not COOP, which severs the
`window.opener` relationship with cross-origin openers.

Low impact here — the only outbound link is the GitHub one at `+layout.svelte:71-75`, which
already correctly carries `rel="noopener noreferrer"`. COOP is defence in depth for links added
later that forget it.

### Action

Add `response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')` alongside the existing
headers.

---

<a id="sec-3"></a>

## SEC-3 — Cookie values are written unencoded

**Priority:** P3 · **Effort:** S

### What

`src/lib/cookies.ts:6-9`:

```ts
export function rememberCookie(name: string, value: string, maxAge: number) {
	const secure = location.protocol === 'https:' ? '; secure' : '';
	document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}
```

`value` is interpolated straight into the cookie string. **Not exploitable today** — there are
exactly two call sites and both pass values from closed sets: locale IDs (`state.svelte.ts:49`)
and league IDs (`+page.svelte:26`). The cookie attributes themselves are all correct: `Lax`,
path-scoped, and conditionally `Secure` with a good explanation for the condition.

The issue is that the signature accepts any `string`, so the safety lives in the callers rather
than in the function.

### Action

Either `encodeURIComponent(value)`, or narrow the parameter type so only the known-safe unions
can be passed. The type-level fix is the better one — it makes the guarantee visible.

---

<a id="sec-4"></a>

## SEC-4 — Redirect param interpolated into `Location` unencoded

**Priority:** P3 · **Effort:** S

### What

`src/routes/[[lang=locale]]/game/[team]/+page.server.ts:5-8`:

```ts
export function load({ params }) {
	const prefix = params.lang ? `/${params.lang}` : '';
	redirect(301, `${prefix}/game/nhl/${params.team.toUpperCase()}`);
}
```

`params.team` is attacker-controlled and goes into a `Location` header.

**This is not an open redirect.** A route segment cannot contain `/`, so the target always stays
on-origin, and `params.lang` is constrained to `'fr'` by the matcher at `src/params/locale.ts:8`.
A URL-encoded `%0D%0A` would decode into the param, but Node rejects CR/LF in header values — so
the outcome is a 500, not a header injection.

It is the correct shape rather than a live vulnerability: user input reaching a response header
without encoding is a pattern worth not having in the codebase, and the fix costs nothing.

### Action

`encodeURIComponent(params.team.toUpperCase())`.

Keep the route itself — the comment at `:3-4` explains it preserves pre-PWHL bookmarks
(`/game/TOR`), which is worth maintaining.

---

<a id="sec-5"></a>

## SEC-5 — Remove `/api/sync` and `SYNC_TOKEN`

**Priority:** P1 · **Effort:** S

Added 2026-07-27, after the admin dashboard landed.

### What

The app now has two secrets and two authentication paths guarding the same capability. `ADMIN_TOKEN`
gates `/admin`, which can already see everything. `SYNC_TOKEN` gates `POST /api/sync`, whose only
function is to force a full roster refresh.

That second path buys nothing:

- **Nothing calls it.** There is no cron in `fly.toml`, no schedule in `.github/workflows/ci.yml`,
  and no external caller. The endpoint's own comment says so: _"Nothing calls this on a schedule —
  it's here for pushing new data out immediately."_ Outside `.env`, `README.md`, and these docs,
  the only reference to `SYNC_TOKEN` in the repository is the endpoint that reads it.
- **It is not even a separate implementation.** `api/sync/+server.ts:3` imports `tokenMatches`
  from `$lib/server/admin`. The crypto is already shared; what is duplicated is the _secret_ and
  the public entry point.
- **It is the expensive one.** A successful call walks every team in every league and takes one to
  two minutes of upstream work.

So the surface is a publicly reachable POST that triggers minutes of upstream traffic, guarded by
a second secret that has to be generated, stored in Fly, rotated, and documented — to serve a
workflow that happens by hand, a few times a year, by someone who is already able to log into
`/admin`.

### The `?wait=true` problem

Worth recording, because it is the reason the replacement should not simply be a blocking button.

`?wait=true` is the documented way to use this endpoint, and the comment at `:41-45` explains why:
without it, _"on Fly the machine can be stopped for idleness once this request returns"_. But
`?wait=true` transfers **no bytes** until the sync completes, and Fly's proxy closes a connection
idle for around 60 seconds. A one-to-two-minute sync therefore plausibly gets cut mid-flight — at
which point the machine can be stopped for idleness anyway, which is the exact failure the flag
exists to prevent.

This has presumably never been noticed because the endpoint is invoked by hand and a truncated
response looks like a network hiccup rather than a bug.

### The replacement already exists

> [!IMPORTANT]
> This finding originally proposed building a resync action on `/admin`. **It is already
> built** — `ff92fdf` shipped it, and it is the exact shape this finding was going to argue for:
>
> - `admin/+page.server.ts:215-227` — a `resync` form action that re-checks `isAuthenticated`
>   (its comment notes that actions are their own endpoints, so the `load` guard does not cover a
>   POST), calls `syncRostersOnce()`, and returns immediately rather than hanging the form post.
> - `admin/+page.svelte:15` — `setInterval(() => invalidateAll(), 4000)`, so the page polls.
> - `admin/+page.server.ts:26-73` — `syncPanel()`, rendering per-league freshness and progress
>   from `sync_state` and `teams.rosterSyncedAt`. Its comment explains why progress is measured
>   against a timestamp rather than a counter: the sync is fire-and-forget and the machine can
>   restart under it, and a timestamp in the database survives that.
>
> The `resync` comment even records the keep-alive reasoning independently — _"that polling is
> also what keeps Fly from stopping the machine out from under the sync while it runs."_
>
> So this finding is **pure deletion**. There is nothing to build.

### Action

1. Delete `src/routes/api/sync/+server.ts` and its directory.
2. Remove `SYNC_TOKEN` from `.env.example`, the local `.env`, and the `README.md` secrets table.
3. Unset the Fly secret: `flyctl secrets unset SYNC_TOKEN`. This restarts the machine, so do it
   with the deploy rather than on its own.

CSRF needs no extra work — SvelteKit form actions check the request origin, and the session cookie
is already `sameSite: 'strict'` (`admin.ts:59`).

### Consequences elsewhere

- **[ABUSE-3](./05-abuse-resistance.md#abuse-3) is superseded.** Do not implement its startup
  length check; the secret is going away. Its generation guidance moves to `ADMIN_TOKEN`.
- **[ABUSE-1](./05-abuse-resistance.md#abuse-1) narrows** to a single call site, which makes the
  rate limiter simpler.
- **[MAINT-3](./09-maintainability.md#maint-3)**: the README secrets table becomes `DATABASE_URL`
  and `ADMIN_TOKEN`, and the `/api/sync` documentation comes out rather than being written.
- **[`../hosting.md`](../hosting.md)** step 4 changes from a `curl` before posting to clicking
  resync in `/admin`.

### The one thing given up

Scriptability. If scheduled syncing is ever wanted, the answer is a Fly scheduled machine calling
`syncRostersOnce()` directly, not an HTTP endpoint with its own secret — so even that case does
not argue for keeping this.
