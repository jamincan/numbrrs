# Hosting costs and launch scaling

Analysis written 2026-07-27, ahead of posting numbrrs to
[r/hockey](https://reddit.com/r/hockey) (~1.4M members).

## Context

numbrrs runs as a single `shared-cpu-1x` / 256MB machine in `yyz` with
`min_machines_running = 0` and `auto_stop_machines = 'stop'` (`fly.toml`), backed
by SQLite on a Fly volume mounted at `/data` (`src/lib/server/db/index.ts`).

Traffic at time of writing is **~19 unique visitors/day** — the app has only been
shared with a few people and a small Discord server.

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

### 4. Warm the roster cache immediately before posting — free

`POST /api/sync?wait=true` with `SYNC_TOKEN` right before the post goes up. A full
sync is ~1–2 minutes and guarantees nobody arriving from Reddit eats an 8s upstream
fetch. `src/routes/api/sync/+server.ts` already documents the `?wait=true`
requirement for exactly this reason — without it, the machine can be stopped for
idleness mid-sync.

### 5. Set concurrency limits in `fly.toml`

An `[http_service.concurrency]` block with sane `soft_limit` / `hard_limit` lets Fly
spread load and shed excess rather than piling requests onto one box until it dies.
Degraded-but-up beats OOM.

## In-memory rosters

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

1. Set `min_machines_running = 1` in `fly.toml` — one line, do it first
2. Wire up hosted error logging (Sentry free tier) — you want it _during_ the spike
3. Add cache headers + Cloudflare, resolving the locale/cookie interaction — the
   actual insurance policy
4. If (3) isn't ready by post day: pre-scale to 3× `shared-cpu-2x` 1GB, post, scale
   back down. $0.63, no code.
5. Warm the roster cache via `/api/sync?wait=true` minutes before posting

Independently, whenever convenient: move rosters in-memory and delete the SQLite
layer. Skip self-hosted Postgres until there's data worth joining.

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

The error-logging work referenced above lives on a separate machine and is not
committed here. `ADMIN_TOKEN` and `ALERT_WEBHOOK_URL` were added to `.env.example`
locally but deliberately left uncommitted; they are referenced nowhere in `src/`.

There is also no observability in the app today — no `[metrics]` block in
`fly.toml`, no structured logging, and no rate limiting on any route. The nearest
thing is the deliberate guard in `ensureTeam()`, which 404s unknown team codes
without hitting upstream. With a public, always-on, uncached origin, the absence of
rate limiting is the most likely cause of a surprise bill; a CDN largely covers it.
