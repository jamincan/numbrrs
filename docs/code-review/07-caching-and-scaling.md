# Caching and scaling

---

<a id="perf-1"></a>

## PERF-1 — No page-level `Cache-Control`

**Priority:** P1 · **Effort:** S

### What

No page response sets a caching policy. `sitemap.xml/+server.ts:31` is the only route in the
project that sets `Cache-Control` at all.

Every request — including identical repeat requests for the same team page — re-runs the load
function, queries SQLite, and re-renders on a 256MB shared-CPU VM with
`min_machines_running = 0`.

The content barely changes. Rosters refresh on a 12-hour TTL and team lists on 24 hours
(`server/leagues/index.ts:19-20`). Team pages are effectively static between syncs. This is the
cheapest available protection against a traffic spike, and it is currently absent.

### Action

Set `Cache-Control` on page responses in `hooks.server.ts`, excluding `/api/*`. Something like
`public, max-age=0, s-maxage=300, stale-while-revalidate=3600` — no browser caching (so a
returning visitor sees fresh data), meaningful shared-cache caching, and stale-while-revalidate
so a cache miss never blocks on an origin that might be doing an 8-second upstream sync.

### Two traps — read before implementing

**1. The home page varies by cookie.** `[[lang=locale]]/+page.server.ts:9-15` reads
`LEAGUE_COOKIE` and returns `initialLeague`, which selects the rendered league tab. The comment
at `:12-14` explains this is deliberate — resolved server-side so the grid and its links are in
the first byte for crawlers. That is good SEO reasoning, but it means **the home page HTML
differs per visitor**. Caching it publicly would serve one visitor's remembered league tab to
everyone.

Pick one: exclude `/` from shared caching, add `Vary: Cookie` (which makes the cache near-useless
for it), or move the tab selection client-side and accept the SEO cost. Excluding the home page
is probably right — team pages are the long-tail traffic and they have no such dependency.

**2. The existing `Vary` header is already incomplete.** `hooks.server.ts:43-45` appends
`vary: Accept-Language` on unprefixed localized routes, and the comment at `:31-33` correctly
explains why the redirect at `:27-35` must not be shared between visitors. But that redirect
depends on **both** `Accept-Language` **and** the locale cookie (`:24`) — and `Vary: Cookie` is
never set.

Today nothing caches these responses, so the gap is inert. The moment PERF-1 lands it becomes a
live correctness bug: a shared cache could serve a French redirect to a visitor who explicitly
chose English. Fix the `Vary` before or alongside adding the cache headers, not after.

---

<a id="perf-2"></a>

## PERF-2 — The app cannot scale past one machine

**Priority:** P2 · **Effort:** S (documentation only)

### What

Three independent constraints pin the app to a single process, none of them written down:

1. **The database.** `fly.toml:21-23` mounts one volume at `/data` for SQLite. A Fly volume
   attaches to exactly one machine.
2. **In-flight sync coalescing.** The `inFlight` map at `server/leagues/index.ts:48` and the
   `fullSync` latch at `:308` are module-scope, per-process. A second instance would run
   duplicate syncs against the leagues and could interleave the delete-then-insert transactions
   at `:94-121` and `:145-186`.
3. **Rate limiting**, once [ABUSE-1](./05-abuse-resistance.md#abuse-1) lands, will be in-memory
   for the same reason.

So `min_machines_running = 0` with a single VM is not merely the current configuration — it is
the only correct one. Scaling to two machines would silently corrupt sync behaviour before
anything obviously broke.

### Action

**No code change.** SQLite is the right choice at this size, and the single-machine model is
appropriate for the traffic. The problem is only that the ceiling is undiscovered until someone
runs `fly scale count 2` during an incident.

Add a "Scaling" section to `README.md` (or `docs/`) stating the constraint, the three reasons,
and the exit path when it is reached:

- **LiteFS** for read replicas, keeping SQLite and a single writer.
- **Postgres**, which Drizzle supports via a dialect swap — the schema in `db/schema.ts` is
  plain and would port with little friction. The sync-coalescing state would need to move into
  the database or Redis.

Together with PERF-1, a single cached machine will absorb considerably more traffic than an
uncached one, which likely defers this decision well past the current horizon.

---

<a id="perf-3"></a>

## PERF-3 — No health check endpoint

**Priority:** P2 · **Effort:** S

### What

`fly.toml:9-14` defines an `http_service` with no `[[http_service.checks]]`. Fly can tell that
the process is listening; it cannot tell that the app is functional.

This matters specifically because of [ERR-4](./02-error-handling.md#err-4): if migrations fail at
boot, the process starts, binds the port, and serves 500s. Fly sees a healthy machine.

### Action

Add `src/routes/api/health/+server.ts` returning a cheap database liveness probe — a
`SELECT 1`-equivalent, or a count from `sync_state` — and wire it into `fly.toml`:

```toml
[[http_service.checks]]
  interval = '30s'
  timeout = '5s'
  method = 'GET'
  path = '/api/health'
```

Keep it genuinely cheap. A health check that touches the league APIs, or that blocks on the sync
path, turns an upstream outage into a restart loop.

Exclude it from caching ([PERF-1](#perf-1)) and from rate limiting
([ABUSE-1](./05-abuse-resistance.md#abuse-1)).

---

## Done 2026-07-27 — PERF-1

Both traps this finding warned about were real, and both are handled.

**The `Vary` was fixed first, not after.** The locale redirect depends on the Accept-Language
header _and_ the locale cookie, but only declared `Accept-Language`. That was inert while nothing
cached; it would have become a live bug the moment this finding landed. `Vary` is now
`Accept-Language, Cookie` on every unprefixed localized response — the redirect and the page
alike, since both live at the same URL and a cache has to tell them apart.

**The home page is excluded from shared caching**, as this finding recommended. It resolves the
remembered league tab server-side so the grid and its links are in the first byte for crawlers,
which is good SEO and also means the HTML differs per visitor.

What each route now sends, verified against the built server:

| Route              | `Cache-Control`                                                | `Vary`                    |
| ------------------ | -------------------------------------------------------------- | ------------------------- |
| `/`, `/fr`         | `private, no-cache`                                            | `Accept-Language, Cookie` |
| `/game/nhl/TOR`    | `public, max-age=0, s-maxage=300, stale-while-revalidate=3600` | `Accept-Language, Cookie` |
| `/fr/game/nhl/TOR` | same                                                           | none needed               |
| `/privacy`         | same                                                           | `Accept-Language, Cookie` |
| `/admin`           | `private, no-store`                                            | —                         |
| `/sitemap.xml`     | `public, max-age=3600` (its own, untouched)                    | —                         |

Prefixed French URLs carry no `Vary` because no negotiation happens on them — the prefix has
already decided.

Negotiation itself was tested three ways: a French browser with no cookie gets the 302, a French
browser that explicitly chose English gets the page, and an English browser gets the page. That
middle case is the one the missing `Vary` would eventually have broken.

> [!IMPORTANT]
> **`Vary: Cookie` is honest at the origin but Cloudflare will largely ignore it** — on the free
> plan Cloudflare only varies on `Accept-Encoding`. Before putting a CDN in front (see
> [`../hosting.md`](../hosting.md)), decide how unprefixed URLs should be handled there: either
> exclude them from the edge cache, or move the redirect decision to the edge so the origin stops
> negotiating. Prefixed `/fr/...` and `/privacy` are safe to cache aggressively today either way.
>
> The good news for a spike is that the visitors this costs least for are exactly the ones a
> Reddit link brings: arriving with no cookies at all, they share one cache entry.
