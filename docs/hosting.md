# Hosting costs and launch scaling

Analysis written 2026-07-27, ahead of posting numbrrs to
[r/hockey](https://reddit.com/r/hockey) (~1.4M members).

> [!IMPORTANT]
> **Revised later the same day.** Two inputs changed after this was written: the telemetry and
> admin dashboard work landed (`586b5e4`, `ff92fdf`), and the analytics it added produced a real
> traffic number for the first time. The revisions are marked inline. The one materially changed
> conclusion is [Storage architecture](#storage-architecture) — the in-memory-rosters proposal
> below rested on a premise that the dashboard commit invalidated.
>
> **Decided:** do the [hardening review](./code-review/) first, then post. Nothing here is a
> blocker for that ordering.

## Context

numbrrs runs as a single `shared-cpu-1x` / 256MB machine in `yyz` with
`min_machines_running = 0` and `auto_stop_machines = 'stop'` (`fly.toml`), backed
by SQLite on a Fly volume mounted at `/data` (`src/lib/server/db/index.ts`).

Traffic at time of writing was estimated at **~19 unique visitors/day** — the app had only been
shared with a few people and a small Discord server.

> [!NOTE]
> **Measured, 2026-07-27: ~51 unique visitors/day.** The estimate above predates the app having
> any analytics at all; this is the first real number. It is 2.7× the guess, which moves nothing
> in this document — every scenario below was already under a dollar — but the baseline is worth
> correcting before someone quotes it back. Concretely, 51 visitors at ~6 pageviews is ~300 events
> per day, or roughly 5 MB over the 90-day retention window.

Three things prompted this analysis: the intent to post to r/hockey, a desire for
horizontal-scaling headroom, and error logging (built separately, see
[Not in this repo](#not-in-this-repo)) that would need somewhere to write.

## The finding

**Cost is not the risk. CPU during a 2–3 hour window is the risk.**

A front-page r/hockey post will cost roughly **$1.35** in Fly bills, one time.
Steady-state hosting is a few dollars a month under every option considered. The
invoice is never the problem.

What is the problem: a `shared-cpu-1x` gets a fraction of a physical core with a
burst credit balance that **depletes under sustained load** — precisely the load
shape a Reddit post produces. A well-received post takes the site down as currently
configured, during the one window where being down actually costs something.

## Measured page weights

From devtools, empty cache:

| Page             | Total transfer | Images | Est. origin egress |
| ---------------- | -------------- | ------ | ------------------ |
| NHL teams page   | 75.25 kB       | none   | **75 kB**          |
| Random game page | 273.86 kB      | 183 kB | **~91 kB**         |

The game-page figure assumes the 183 kB of images are hot-linked from
`assets.nhle.com` / HockeyTech (`src/lib/server/leagues/`) rather than served from
`src/lib/assets/logos/`, which are baked into the container image. See
[Open questions](#open-questions) — this is the one unverified input.

Modelling a session as ~6 pageviews (land on teams → pick team → play several
rounds), with fonts/JS/CSS cached after the first hit:

**~300 kB of origin egress per visitor.**

## Spike scenarios

Reddit traffic is heavily front-loaded — most arrives in the first 3–6 hours. Peak
req/s assumes ~60% of the day's traffic in a 3-hour window, with a 2.5× peak-vs-average
inside it.

| r/hockey outcome        | Visitors/24h | Origin egress | Egress cost | Peak req/s |
| ----------------------- | ------------ | ------------- | ----------- | ---------- |
| Flops (~50 upvotes)     | ~500         | 0.15 GB       | <$0.01      | ~1         |
| Modest (~500 upvotes)   | ~8k          | 2.4 GB        | $0.05       | **~8**     |
| Good (~2k upvotes)      | ~40k         | 12 GB         | $0.24       | **~33**    |
| Big (5k+, cross-posted) | ~120k        | 36 GB         | $0.72       | **~100**   |

The entire bandwidth bill for a front-page post is under a dollar.

### Where it breaks

SvelteKit SSR runs on every request via `src/hooks.server.ts` plus the route
loaders. Estimated sustained ceiling for the current machine is **~5–15 req/s**,
degrading as burst credits drain. That puts "modest post" at the edge and **"good
post" comfortably past it.**

Three secondary failure modes compound it:

- **Cold start.** With `min_machines_running = 0`, the first visitor from Reddit
  pays a container boot _plus_ potentially the 8s `BLOCKING_TIMEOUT` roster fetch
  in `src/lib/server/leagues/index.ts`, while everyone behind them queues.
- **No concurrency limits.** `fly.toml` has no `[http_service.concurrency]` block,
  so Fly's defaults let many concurrent requests pile onto one 256MB box — which
  turns slow into OOM.
- **Cold roster cache.** Thousands of people hitting team pages with stale rosters
  triggers upstream syncs. The `inFlight` coalescing in
  `src/lib/server/leagues/index.ts` handles the thundering herd per-team, but each
  first request can still block up to 8s.

## Preparation, in priority order

### 1. Put a CDN in front — highest leverage by a wide margin

A Reddit spike is the most cache-friendly traffic pattern that exists: thousands of
people hitting **the same handful of URLs** within minutes. numbrrs serves
identical public content on a 12-hour TTL (`ROSTER_TTL`) / 24-hour TTL
(`TEAM_LIST_TTL`). A hit ratio north of 95% means the origin sees a trickle and the
CPU problem stops existing.

Cloudflare's free tier is sufficient. This converts "survive 100 req/s" into
"nothing happens."

Currently **exactly one route sets a cache header** —
`src/routes/sitemap.xml/+server.ts` (`max-age=3600`). The page routes set none.

The real work is the cookie/locale interaction, and it deserves proper thought
rather than a bolt-on:

- `src/hooks.server.ts` can 302 to `/fr/...` based on locale negotiation
- `numbrrs_locale` and `numbrrs_league` cookies (`src/lib/leagues.ts`) vary behaviour
- A naive `Vary: Cookie` destroys the hit ratio entirely

Likely shape: cache strictly per URL path (locale is already in the path, which
helps a lot), keep the league-tab cookie a client-side concern, and ensure cached
responses carry no `Set-Cookie`. Roughly a day of careful work.

> [!NOTE]
> **Partially done 2026-07-28.** The canonical domain moved to numbrrs.app
> (numbrrs.ca redirects there — see `hooks.server.ts`), and numbrrs.app is proxied
> through Cloudflare: DNS is AAAA-only per Fly's proxied-setup guidance, SSL/TLS mode
> is Full (strict), and Cache Level is left at the default Standard. Verified against
> the live site — `server: cloudflare` and `via: 1.1 fly.io` both present, and
> `cf-cache-status: DYNAMIC` on page routes confirms HTML isn't being cached, which
> is correct at this stage: Standard only caches static assets by file extension
> (this app's own `_app/immutable/*` bundle, self-hosted fonts and logos), never HTML,
> so there is no risk yet from Cloudflare's free tier ignoring `Vary: Cookie`.
>
> **The HTML-caching Worker landed 2026-07-28, scoped to `/privacy` only.**
> `wrangler.toml` + `cloudflare/locale-cache-worker.ts` (config-as-code, same shape as
> `fly.toml` + `flyctl deploy` — `pnpm run cf:deploy` wraps `wrangler deploy`). It
> doesn't re-decide English-vs-French itself; it imports `negotiateLocale` and
> `localeFromPath` straight from `src/lib/i18n` and uses them to compute which
> **cache slot** a request belongs in, via the Workers Cache API (`caches.default`)
> rather than Cloudflare's zone-level cache — that's what makes vary-by-cookie work
> on the free plan without Business tier's custom cache keys. It only ever writes to
> cache when the origin's own response says it's shareable (`public` + `s-maxage`),
> so it needs no route list of its own; home and `/admin` are already excluded by
> their own `Cache-Control`. Unit-tested directly (`cloudflare/locale-cache-worker.test.ts`,
> run by the same `pnpm test`) rather than through the full Workers runtime — the
> locale-bucketing logic only needs `Request`/`URL`, which Vitest's Node
> environment already provides.
>
> **Expanded to `/game/*` the same day.** The plan had been to wait and watch
> `/privacy` first, but that reasoning didn't survive contact with the actual
> traffic pattern: `/privacy` and `/game/<league>/<team>` run through the identical
> Worker code path with no route-specific branching, and `/privacy` gets close to no
> organic traffic — so waiting on it wouldn't have produced any evidence a direct
> test couldn't produce faster. `wrangler.toml`'s `routes` now covers
> `numbrrs.app/game/*` and `numbrrs.app/fr/game/*` too (which also matches the legacy
> no-league `/game/<TEAM>` redirect route harmlessly — its response isn't `public` +
> `s-maxage` either, so the Worker never caches it, same as the locale redirect).
>
> **Deployed and verified 2026-07-28**, via `pnpm run cf:deploy` from an
> authenticated `wrangler login` session. Against the live site: a second request to
> `/privacy` returns `cf-cache-status: HIT`; `/fr/privacy` caches independently with
> the correct `lang="fr"` content; and — the case that actually matters — a
> French-preferring request (`Accept-Language: fr`, no cookie) redirects to
> `/fr/privacy` as before, and a plain English request to the same unprefixed
> `/privacy` URL immediately afterward still returns `lang="en"`, confirming the
> locale-bucketed cache key does its job rather than leaking one visitor's outcome
> to another.
>
> One detail worth recording: the French redirect response itself is never cached
> (stays `DYNAMIC` on repeat requests), because `hooks.server.ts` already marks it
> `private, no-store` — a defensive choice made before this Worker existed ("caches
> must not serve one visitor's answer to another"). The Worker correctly respects
> that and skips it. Not a gap: redirects are cheap to regenerate, and the
> expensive thing worth caching — the full rendered HTML — is exactly what's
> covered.

### 2. Pre-scale before posting — cheap insurance, zero code

```sh
fly scale vm shared-cpu-2x --memory 1024
fly scale count 3
```

Three `shared-cpu-2x` / 1GB machines for 24 hours costs about **$0.63**. Scale back
down the next day. Covers the "good post" scenario outright with no code changes.

Do **not** rely on `auto_start_machines` to absorb the spike — Machine autoscaling
is not instantaneous and a Reddit peak can outrun it.

### 3. `min_machines_running = 1` — one line

Removes the cold-start failure mode entirely. ~$1.94/mo.

> [!NOTE]
> **Done 2026-07-28**, ahead of the CDN and the load test — cheap, reversible, and no reason to
> wait on either.

### 4. Warm the roster cache immediately before posting — free

Trigger a full sync right before the post goes up. It takes ~1–2 minutes and guarantees nobody
arriving from Reddit eats an 8s upstream fetch.

> [!IMPORTANT]
> **Revised 2026-07-27.** This step originally read `POST /api/sync?wait=true` with `SYNC_TOKEN`.
> That endpoint and that secret are being **removed** — the same capability behind a second
> secret and a second public entry point is surface for no benefit, and nothing calls it on a
> schedule. It is replaced by a resync action on `/admin`.
>
> The replacement is also more likely to work. `?wait=true` blocks without sending any bytes
> until the sync completes, and **Fly's proxy closes a connection idle for ~60 seconds** — so a
> 1–2 minute sync plausibly gets cut, at which point the machine can be stopped for idleness
> mid-sync, which is the exact failure `?wait=true` existed to prevent. A dashboard that fires
> the sync and then polls generates a request every few seconds, which keeps the machine awake
> far more reliably and shows progress besides. `sync_state` and `teams.rosterSyncedAt` already
> hold everything that progress view needs.

### 5. Set concurrency limits in `fly.toml`

An `[http_service.concurrency]` block with sane `soft_limit` / `hard_limit` lets Fly
spread load and shed excess rather than piling requests onto one box until it dies.
Degraded-but-up beats OOM.

> [!NOTE]
> **Done 2026-07-28.** `type = 'connections'`, `soft_limit = 20`, `hard_limit = 25` — sized for the
> current `shared-cpu-1x` / 256MB `[[vm]]`; revisit alongside any machine-size change, and
> certainly before any pre-scale to `shared-cpu-2x`.

## In-memory rosters

> [!WARNING]
> **The premise below no longer holds.** This section argues that the database can be deleted
> because it contains only derived data. Migration `0007` (`586b5e4`) added `events` and `errors`,
> which are neither derived nor re-fetchable — losing them on deploy means losing the analytics.
> The reasoning about _rosters_ is still correct and still worth acting on eventually; what
> changed is that acting on it no longer deletes the database. See
> [Storage architecture](#storage-architecture) for where this landed.

`src/lib/server/db/schema.ts` holds three tables — `teams`, `players`, `sync_state`
— totalling ~100 teams and ~3,000 player rows, **total, forever**. Nothing grows
per user: there are no accounts, sessions, or scores. It is entirely derived data,
re-fetchable from league APIs in minutes. That is a cache, not a system of record.
As JS objects it's roughly 2–5 MB of heap.

Holding it in memory deletes `better-sqlite3`, `drizzle-orm`, the seven `drizzle/`
migrations, and the `[mounts]` volume.

It's easy — maybe half a day — because `src/lib/server/leagues/index.ts` **already
owns the TTL logic, the `inFlight` request coalescing, and the lazy per-team
`loadRoster()` flow**. You swap the storage backend underneath that file rather
than restructuring it. And because `better-sqlite3` queries are already
synchronous, in-memory Map reads are a drop-in — route loaders don't become async.
That async conversion is the expensive part of most database migrations, and this
approach skips it.

It also makes the per-process `inFlight` / `fullSync` state a non-issue rather than
a bug: each machine maintains its own copy, so horizontal scaling becomes
`fly scale count`. No advisory locks, no LiteFS, no read replicas, no leader
election, no session affinity.

The one behaviour change: nothing survives a restart, so each deploy re-warms
lazily from upstream. Given the existing per-team pattern that's mild — a new
machine fetches the 5 league team lists on first home-page hit, then rosters one
team at a time on demand. It does not need a ~100-team full sync at boot.

**But this is not spike preparation.** SQLite reads are already sub-millisecond and
in-process; they are not what falls over at 30 req/s. Do it because it's a genuine
simplification.

### Caveat if machine count goes high

N machines means N× independent upstream syncs. At N=4 with 12h/24h TTLs this is
negligible. At N=20 it stops being negligible, and a shared warm store becomes
worth revisiting. The HockeyTech key in `src/lib/server/leagues/chl.ts` is
hardcoded and shared across CHL consumers — worth not hammering.

## Error logging

> [!IMPORTANT]
> **Overtaken by events.** This section recommends a hosted error tracker instead of self-hosting.
> First-party telemetry shipped the same day (`586b5e4`) — errors and usage events both write to
> the existing SQLite database, with a Discord webhook for alerting. The recommendation was not
> rejected on the merits; the work was simply already done. It is kept here because the
> _reasoning_ about unmanaged Postgres is still sound and still the reason not to add one.
>
> One correction the original missed: **Sentry is error tracking, not analytics.** It would
> replace the `errors` table, not the `events` table, and it will not produce the per-league,
> per-team, per-locale visitor breakdown the dashboard renders. "Drop the database and use Sentry"
> was never a complete substitution — it needs a second vendor for usage analytics.

Recommendation at current scale: **use a hosted free tier, not self-hosted
Postgres.**

Self-hosting means maintaining an instance, a volume, migrations, a connection
pool, a retention/pruning job, and insert rate-limiting (one bad deploy can produce
an error storm that fills a 1GB volume) — on infrastructure Fly explicitly will not
support: _"We are not able to provide support or guidance for unmanaged
Postgres."_ A single-node instance loses everything since the last snapshot if the
SSD fails.

Sentry's free tier is 5k errors/month at $0 and needs none of that. Axiom and
Better Stack are comparable. Two lines of SDK setup.

The case for running your own is wanting error logs joined to other data — but
there is no other data yet. **Revisit if user accounts or persisted scores are
added**, at which point durability requirements change and
[Fly Managed Postgres](https://fly.io/docs/mpg/) ($38/mo, Basic) enters the picture.

A spike is when error logging pays for itself — it surfaces the bugs 19 visitors
never triggered. Worth having in place _before_ posting.

<a id="storage-architecture"></a>

## Storage architecture — decided 2026-07-27

Written after this document's two storage proposals ([in-memory rosters](#in-memory-rosters),
[hosted error logging](#error-logging)) collided with the telemetry work landing. This section
supersedes both.

### The four options

The app now stores two kinds of thing with genuinely different requirements: **rosters**, which
are derived, ~3,000 rows, and re-fetchable in minutes; and **telemetry**, which is not derived,
grows with traffic, and is the only record of what happened.

|                            | Rosters | Telemetry                | App stateless? | You operate a database? | Cost                |
| -------------------------- | ------- | ------------------------ | -------------- | ----------------------- | ------------------- |
| **A** — today              | SQLite  | SQLite                   | No             | No (it is a file)       | $0                  |
| **B** — hosted             | Memory  | Sentry + Plausible/Umami | Yes            | No                      | ~$9/mo, two vendors |
| **C** — unmanaged Postgres | Memory  | Postgres on Fly          | Yes            | **Yes**                 | ~$6/mo + operations |
| **D** — managed serverless | Memory  | Turso or Neon            | Yes            | No                      | $0 at this scale    |

### Why not C

C makes the _app_ horizontally scalable — that part is real, and worth stating because it is easy
to dismiss C for the wrong reason. What it does **not** do is remove the volume: Fly's unmanaged
Postgres is itself a Fly app with its own volume. The volume relocates rather than disappearing,
and it relocates onto infrastructure Fly says plainly it will not support, where a single node
loses everything since the last snapshot if the SSD fails.

So the choice between B, C, and D was never "volume or no volume". It is **who operates the
durable store**, and C is the only option where the answer is you — in exchange for holding
90-day-retention analytics.

### Why D beats C

If the goal is a durable telemetry store you do not operate, that is what managed serverless
databases are. **Turso** fits this codebase unusually well: it is libSQL, so the Drizzle schema
and the existing migrations largely carry over as a dialect swap rather than a rewrite.

There is a neat interaction worth recording. The objection to leaving `better-sqlite3` has always
been that its queries are synchronous, and going async is the expensive part of most database
migrations — the [in-memory section](#in-memory-rosters) makes exactly this point in favour of
its own proposal. But that cost only applies to code that still talks to the database. **If
rosters move to memory, the only remaining callers are `analytics.ts` and the `/admin` loader.**
Route loaders on the hot path never become async at all. The two changes cancel each other's
main objection, which is why D is coherent in a way that neither half is alone.

### Decision: stay on A, treat D as the end state

Not because A is better, but because **the migration cost does not compound.**

`src/lib/server/leagues/index.ts` already owns the TTL logic, the `inFlight` coalescing, and the
lazy per-team `loadRoster()` flow. Storage sits behind that boundary, which is why this document
estimates the in-memory move at half a day. That estimate is the same in six months — rosters are
~3,000 rows of derived data whenever you migrate. Nothing accumulates that makes the swap harder.

Compare the things that _do_ get more expensive with delay, all of which are in the
[hardening review](./code-review/):

- **Licensing and attribution** (LIC-1, LIC-3) — cheap now, awkward in proportion to how visible
  the site becomes. Posting first inverts the cost.
- **The `events` schema** — once there are 90 days of data, changing its shape means a backfill or
  a visible discontinuity in the dashboard's own charts. Today there are two days. If any part of
  the storage question deserves settling early, it is the schema, not the backend.
- **Runtime validation** (VAL-1) — every day without it is a day an upstream schema change gets
  misclassified as a transient blip.

So the hardening work goes first, and D happens when it stops feeling premature. What is needed
before then is a **retention bound**, not a new backend — see
[ABUSE-4](./code-review/05-abuse-resistance.md#abuse-4). An unbounded table is unbounded on any
backend, and bounding it is an afternoon.

### On GDPR, which points the same way

Counterintuitively, moving telemetry to a hosted provider makes the privacy position **harder**,
not easier. The current implementation — a daily-rotated salt that is never written to disk, no
cookies, host-only referrers, 90-day retention, nothing leaving the infrastructure except error
alerts — is the basis on which cookieless analytics tools claim they need no consent banner. A US
processor adds a DPA, a transfer mechanism, and a processing record, and most error trackers
capture IP addresses by default unless configured otherwise.

What is missing is not a better architecture but a disclosure: see
[PRIV-1](./code-review/10-privacy-and-telemetry.md#priv-1).

### What no option fixes

Two per-process constraints survive in B, C, and D alike, and are worth knowing before "stateless"
is read as "unconstrained":

1. **N machines means N× independent upstream syncs.** Negligible at N=3, not at N=20. The CHL
   HockeyTech key in `src/lib/server/leagues/chl.ts` is shared across consumers and worth not
   hammering.
2. **In-memory rate limiting becomes per-instance.** A limiter on three machines is a 3× looser
   limit. Fine at this scale; worth a comment in the code so it is not a surprise later. See
   [ABUSE-1](./code-review/05-abuse-resistance.md#abuse-1).

Neither is a reason to avoid scaling. Both are reasons the CDN remains the better answer to a
spike than horizontal scaling is, regardless of where the data lives.

## What it costs

| Scenario                                            | Monthly         |
| --------------------------------------------------- | --------------- |
| Today (scale-to-zero, ~5h/day runtime + 1GB volume) | **~$0.55**      |
| Always-on 256MB, no volume, hosted error logging    | **~$1.94**      |
| Always-on `shared-cpu-2x` 512MB (headroom)          | **~$3.89**      |
| Above + self-hosted PG 256MB + 1GB volume           | **~$6**         |
| One-day pre-scale to 3× `shared-cpu-2x` 1GB         | **+$0.63 once** |
| Egress for a front-page r/hockey post               | **+$0.72 once** |

## Fly pricing reference

Figures as of **2026-07-27**, North America / `yyz`. Pricing drifts — re-check
before relying on these.

| Resource                                | Price                                                 |
| --------------------------------------- | ----------------------------------------------------- |
| `shared-cpu-1x` 256MB                   | $1.94/mo                                              |
| `shared-cpu-1x` 512MB                   | $3.19/mo                                              |
| `shared-cpu-1x` 1GB                     | $5.70/mo                                              |
| `shared-cpu-2x` 512MB                   | $3.89/mo                                              |
| `shared-cpu-2x` 1GB                     | $6.39/mo                                              |
| `performance-1x` 2GB                    | $31.00/mo                                             |
| Volumes                                 | $0.15/GB/mo                                           |
| Volume snapshots                        | $0.08/GB/mo, first 10GB free                          |
| Egress (NA/EU)                          | $0.02/GB                                              |
| Dedicated IPv4                          | $2/mo — **not needed**, `http_service` uses shared v4 |
| Managed Postgres (Basic, shared-2x/1GB) | $38/mo + $0.28/GB storage                             |

**There is no free tier and no free egress allowance** on current plans. Fly's cost
management docs state plainly: _"There is no 'free account/free tier' on Fly.io."_

Sources: [resource pricing](https://fly.io/docs/about/pricing/) ·
[cost management](https://fly.io/docs/about/cost-management/) ·
[Managed Postgres](https://fly.io/docs/mpg/) ·
[unmanaged Postgres](https://fly.io/docs/postgres/)

## Handoff notes

### Pre-launch checklist

> [!NOTE]
> **Revised 2026-07-27.** The decision is to work the [hardening review](./code-review/) before
> posting, so this is no longer a race against a post date. Step 2 is already done. The ordering
> below is what remains.

0. ~~Work the hardening review's P1 list.~~ **Done 2026-07-28** — P2 and P3 as well, not just P1.
1. ~~Set `min_machines_running = 1` in `fly.toml`~~ — **done 2026-07-28**, along with concurrency
   limits ([step 5](#5-set-concurrency-limits-in-flytoml)).
2. ~~Wire up hosted error logging (Sentry free tier)~~ — **done differently**: first-party
   telemetry with Discord alerting shipped in `586b5e4`. See
   [Error logging](#error-logging) for why the recommendation was overtaken rather than rejected.
3. ~~Add cache headers + Cloudflare~~ — **partially done 2026-07-28**. Cache headers landed with
   [PERF-1](./code-review/07-caching-and-scaling.md#perf-1), including the `Vary` fix the locale
   redirect needed before anything could safely cache it. The domain also moved to numbrrs.app
   (numbrrs.ca now redirects there) and is proxied through Cloudflare — TLS, DDoS absorption, and
   free edge caching of this app's own static bundle, all live. **Still open:** the actual HTML
   caching (the real insurance policy this step was about) needs a small Cloudflare Worker to make
   the locale decision at the edge, since the free tier has no vary-by-cookie cache key — see
   [step 1's note above](#1-put-a-cdn-in-front--highest-leverage-by-a-wide-margin) for why that's
   deliberately separate from getting Cloudflare live.
4. If (3)'s HTML caching isn't ready by post day: pre-scale to 3× `shared-cpu-2x` 1GB, post, scale
   back down. $0.63, no code. Do this closer to the actual post date, not now.
5. Warm the roster cache from `/admin` minutes before posting — see
   [step 4 above](#4-warm-the-roster-cache-immediately-before-posting--free). A day-of action, not
   something to do ahead of time.
6. ~~Bound event retention~~ ([ABUSE-4](./code-review/05-abuse-resistance.md#abuse-4)) — **done**.

What's left that isn't a day-of-posting action: the Cloudflare Worker for HTML caching (step 3),
and the real req/s ceiling
(still an estimate — see [Open questions](#open-questions), "most valuable single follow-up").

Independently, whenever convenient: move rosters in-memory. This no longer deletes the SQLite
layer — see [Storage architecture](#storage-architecture). Skip self-hosted Postgres regardless;
if telemetry ever moves off the volume, managed serverless (Turso/Neon) is the destination.

### Open questions

- **Are the game-page images hot-linked?** Check the Domain column in devtools on a
  game page. If a meaningful share come from our own origin rather than
  `assets.nhle.com` / HockeyTech, game-page egress is ~180 kB rather than ~91 kB,
  which doubles the egress column. Doesn't change any conclusion — egress is under
  a dollar either way — but it's the one unverified input.
- **What is the real req/s ceiling?** A ten-minute `oha` or `bombardier` run
  against the deployed URL replaces the estimated 5–15 req/s with a measured
  number. **Most valuable single follow-up in this document** — every capacity
  decision above rests on an estimate.
- **How should CDN caching handle locale?** The 302 in `src/hooks.server.ts` and
  the `numbrrs_locale` / `numbrrs_league` cookies need a caching strategy that
  doesn't require `Vary: Cookie`.

Also worth checking: current RSS headroom against the 256MB cap
(`fly machine status`), and actual current spend in the Fly dashboard to confirm
the ~$0.55 baseline.

### Not in this repo

> [!NOTE]
> **No longer true as of `ff92fdf`.** Everything described below has landed. Kept for the record
> of what the analysis assumed.

The error-logging work referenced above lives on a separate machine and is not
committed here. `ADMIN_TOKEN` and `ALERT_WEBHOOK_URL` were added to `.env.example`
locally but deliberately left uncommitted; they are referenced nowhere in `src/`.

There is also no observability in the app today — no `[metrics]` block in
`fly.toml`, no structured logging, and no rate limiting on any route. The nearest
thing is the deliberate guard in `ensureTeam()`, which 404s unknown team codes
without hitting upstream. With a public, always-on, uncached origin, the absence of
rate limiting is the most likely cause of a surprise bill; a CDN largely covers it.

**What actually shipped:** first-party analytics and error tracking writing to the existing
SQLite database (`src/lib/server/analytics.ts`, `alerts.ts`, `telemetry.ts`), a Discord webhook
for alerts, and an `/admin` dashboard behind `ADMIN_TOKEN`. Both secrets are now real and
documented in `README.md`.

Two of the observations above survive and are now tracked findings:

- **Still no `[metrics]` block in `fly.toml`**, and still no health check — see
  [PERF-3](./code-review/07-caching-and-scaling.md#perf-3).
- **Rate limiting is still absent from every route that matters.** One working limiter exists, in
  `src/routes/api/client-error/+server.ts`, but it guards only that endpoint. The `/admin` login
  has nothing in front of it but a 400ms delay. See
  [ABUSE-1](./code-review/05-abuse-resistance.md#abuse-1), which is now the priority it was
  predicted to become.
