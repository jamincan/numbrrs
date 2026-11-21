# Hosting costs and launch scaling

What Numbrrs costs to run, what a large traffic spike does to it, and why the data is stored the
way it is. First written on 2026-07-27, ahead of posting to
[r/hockey](https://reddit.com/r/hockey) (~1.4M members); measurements and decisions made since
carry their own dates. Prices and estimates are from that day unless marked otherwise.

## Context

Numbrrs runs as a single `shared-cpu-1x` / 256MB machine in `yyz`, always on
(`min_machines_running = 1`), backed by SQLite on a Fly volume mounted at `/data`. `numbrrs.app`
is proxied through Cloudflare, where a Worker caches pages at the edge
([below](#the-cdn-in-front)).

**Measured traffic, 2026-07-27: ~51 unique visitors/day.** At ~6 pageviews each that is ~300
events per day, or roughly 5 MB over the 90-day retention window. Every scenario below is far
above that baseline.

## The finding

**Cost is not the risk. CPU during a 2–3 hour window is the risk.**

A front-page r/hockey post will cost roughly **$1.35** in Fly bills, one time. Steady-state hosting
is a few dollars a month under every option considered. The invoice is never the problem.

What is the problem: a `shared-cpu-1x` gets a fraction of a physical core with a burst credit
balance that **depletes under sustained load** — precisely the load shape a Reddit post produces.
Left to serve every request itself, the origin degrades during the one window where that costs
something. That is why the answer is a cache in front of it rather than a bigger bill.

## Measured page weights

From devtools, empty cache:

| Page             | Total transfer | Images | Est. origin egress |
| ---------------- | -------------- | ------ | ------------------ |
| NHL teams page   | 75.25 kB       | none   | **75 kB**          |
| Random game page | 273.86 kB      | 183 kB | **~91 kB**         |

The game-page figure assumes the 183 kB of images are hot-linked from `assets.nhle.com` /
HockeyTech rather than served from `src/lib/assets/logos/`, which are baked into the container
image. See [Open questions](#open-questions) — this is the one unverified input.

Modelling a session as ~6 pageviews (land on teams → pick team → play several rounds), with
fonts/JS/CSS cached after the first hit:

**~300 kB of origin egress per visitor.**

## Spike scenarios

Reddit traffic is heavily front-loaded — most arrives in the first 3–6 hours. Peak req/s assumes
~60% of the day's traffic in a 3-hour window, with a 2.5× peak-vs-average inside it.

| r/hockey outcome        | Visitors/24h | Origin egress | Egress cost | Peak req/s |
| ----------------------- | ------------ | ------------- | ----------- | ---------- |
| Flops (~50 upvotes)     | ~500         | 0.15 GB       | <$0.01      | ~1         |
| Modest (~500 upvotes)   | ~8k          | 2.4 GB        | $0.05       | **~8**     |
| Good (~2k upvotes)      | ~40k         | 12 GB         | $0.24       | **~33**    |
| Big (5k+, cross-posted) | ~120k        | 36 GB         | $0.72       | **~100**   |

The entire bandwidth bill for a front-page post is under a dollar. These are origin figures with
nothing cached; with the CDN in front, the origin sees only the cache misses.

### Where it breaks

SvelteKit renders on the server for every request that reaches the origin. **Measured 2026-07-29**
against a throwaway app on identical hardware (`shared-cpu-1x`, 256MB, yyz, one machine) — see
[`load-test/`](../load-test/):

| State                         | Sustained rate   | p50  | p95   | Failures |
| ----------------------------- | ---------------- | ---- | ----- | -------- |
| Burst credits available       | **100 req/s**    | 12ms | 24ms  | 0%       |
| Credits drained (~25min load) | **~17–20 req/s** | 12ms | 10.3s | 0.04%    |

Two things follow.

**It does not fall over.** 20,207 requests across a 1→100 req/s ramp produced zero failures, zero
restarts and no OOM, with the health check green throughout. The concurrency limits were never
approached: concurrency is rate × latency, so 100 req/s at 12ms is ~1.5 simultaneous connections,
nowhere near `hard_limit = 25`. "Good post" is survivable, not fatal.

**Degradation is a latency tail, not errors.** Once burst credits drain the median holds at 12ms
while p90 goes to ~5.5s. Fly enforces shared-vCPU throttling by withholding CPU in slices, and
Node is single-threaded — so requests landing in a scheduling window stay fast while those
arriving mid-stall queue for seconds. The number to watch is the tail, and it is invisible in an
average.

> [!NOTE]
> The sustained figure is the one that matters for a multi-hour Reddit spike, and it is an origin
> number. With the CDN in front, the origin only sees cache misses, so the arrival rate here is
> not the arrival rate at the edge.

Three secondary failure modes compound the CPU ceiling. Two are closed, and are listed for why the
settings that closed them should stay:

- **Cold start** — closed 2026-07-28 by `min_machines_running = 1`. With scale-to-zero, the first
  visitor from Reddit paid a container boot plus potentially the 8s `BLOCKING_TIMEOUT` roster
  fetch in `src/lib/server/leagues/index.ts`, while everyone behind them queued. An always-on
  machine is also what lets the hourly roster sweep run at all. ~$1.94/mo instead of ~$0.55/mo.
- **No concurrency limits** — closed 2026-07-28 by `[http_service.concurrency]` in `fly.toml`
  (`soft_limit = 20`, `hard_limit = 25`). Fly's defaults let many concurrent requests pile onto
  one 256MB box, which turns slow into OOM; degraded-but-up beats down. The limits are sized for
  this machine, so revisit them with any `[[vm]]` change.
- **Cold roster cache** — narrowed, not closed. A visit to a team whose roster has passed its
  12-hour TTL triggers an upstream sync and can block up to 8s. The `inFlight` coalescing in
  `src/lib/server/leagues/index.ts` handles the thundering herd per team, and the hourly sweep
  refreshes stale rosters before most visitors can find one, but a roster that goes stale between
  sweeps, or whose sync is failing, still costs its first visitor the wait.

## The CDN in front

A Reddit spike is the most cache-friendly traffic pattern that exists: thousands of people hitting
**the same handful of URLs** within minutes. Numbrrs serves identical public content on a 12-hour
TTL (`ROSTER_TTL`) / 24-hour TTL (`TEAM_LIST_TTL`). A hit ratio north of 95% means the origin sees
a trickle and the CPU problem stops existing. Cloudflare's free tier is sufficient, up to the
Worker's daily request quota (see [Before a large post](#before-a-large-post)).

The difficulty is the cookie/locale interaction:

- `src/hooks.server.ts` can 302 to `/fr/...` based on locale negotiation.
- The `numbrrs_locale` and `numbrrs_league` cookies vary what is served.
- A naive `Vary: Cookie` destroys the hit ratio entirely — and Cloudflare's free tier doesn't
  honour `Vary: Cookie` at all, so a Cache Rule can't solve this on its own.

**In place since 2026-07-28.** `numbrrs.app` is proxied through Cloudflare (AAAA-only DNS, SSL/TLS
mode Full (strict)), with a Worker handling the problem above: `wrangler.toml` +
`cloudflare/locale-cache-worker.ts`, config-as-code in the same shape as `fly.toml` +
`flyctl deploy` (`pnpm run cf:deploy` wraps `wrangler deploy`). Which pages it covers is the route
list in `wrangler.toml`.

The Worker doesn't re-decide English-vs-French itself. It imports `negotiateLocale` and
`localeFromPath` straight from `src/lib/i18n` and uses them to compute which **cache slot** a
request belongs in, via the Workers Cache API (`caches.default`) rather than Cloudflare's
zone-level cache. That is what makes vary-by-cookie caching work on the free plan without the
Business tier's custom cache keys, and it means there is no hand-copied locale logic to drift out
of sync: a change to `negotiateLocale` is picked up the next time the Worker deploys. It only ever
writes to the cache when the origin's own response says it is shareable (`public` + `s-maxage`), so
the origin's `Cache-Control` decides what is cached and the Worker needs no list of its own.

Verified against the live site: a second request to a covered page returns `cf-cache-status: HIT`;
the `/fr` equivalent caches independently with the correct content; and — the case that matters —
a French-preferring request (`Accept-Language: fr`, no cookie) redirects as before, and a plain
English request to the same unprefixed URL immediately afterward still returns English, so the
locale-bucketed cache key doesn't leak one visitor's outcome to another. The redirect itself is
never cached (`hooks.server.ts` marks it `private, no-store`), which is fine: redirects are cheap
to regenerate, and the expensive thing worth caching is the rendered HTML.

<a id="storage-architecture"></a>

## Storage architecture — decided 2026-07-27

The app stores two kinds of thing with different requirements: **rosters**, which are derived,
~100 teams and ~3,000 player rows in total, and re-fetchable from the league APIs in minutes; and
**telemetry** (the `events` and `errors` tables), which is not derived, grows with traffic, and is
the only record of what happened.

### The four options

|                            | Rosters | Telemetry                | App stateless? | You operate a database? | Cost                |
| -------------------------- | ------- | ------------------------ | -------------- | ----------------------- | ------------------- |
| **A** — today              | SQLite  | SQLite                   | No             | No (it is a file)       | $0                  |
| **B** — hosted             | Memory  | Sentry + Plausible/Umami | Yes            | No                      | ~$9/mo, two vendors |
| **C** — unmanaged Postgres | Memory  | Postgres on Fly          | Yes            | **Yes**                 | ~$6/mo + operations |
| **D** — managed serverless | Memory  | Turso or Neon            | Yes            | No                      | $0 at this scale    |

B needs two vendors because Sentry is error tracking, not analytics: it would replace the `errors`
table but not the `events` table, and it does not produce the per-league, per-team, per-locale
breakdown the dashboard renders.

### Why not C

C makes the _app_ horizontally scalable — that part is real, and worth stating because it is easy
to dismiss C for the wrong reason. What it does **not** do is remove the volume: Fly's unmanaged
Postgres is itself a Fly app with its own volume. The volume relocates rather than disappearing,
and it relocates onto infrastructure Fly says plainly it will not support (_"We are not able to
provide support or guidance for unmanaged Postgres"_), where a single node loses everything since
the last snapshot if the SSD fails. It also brings an instance, migrations, a connection pool and
a pruning job to maintain.

So the choice between B, C, and D was never "volume or no volume". It is **who operates the
durable store**, and C is the only option where the answer is you — in exchange for holding
90-day-retention analytics.

### Why D beats C

If the goal is a durable telemetry store you do not operate, that is what managed serverless
databases are. **Turso** fits this codebase unusually well: it is libSQL, so the Drizzle schema
and the existing migrations largely carry over as a dialect swap rather than a rewrite.

There is a neat interaction worth recording. The objection to leaving `better-sqlite3` has always
been that its queries are synchronous, and going async is the expensive part of most database
migrations. But that cost only applies to code that still talks to the database. **If rosters move
to memory, the only remaining callers are `analytics.ts` and the `/admin` loader.** Route loaders
on the hot path never become async at all. The two changes cancel each other's main objection,
which is why D is coherent in a way that neither half is alone.

### Decision: stay on A, treat D as the end state

Not because A is better, but because **the migration cost does not compound.**

`src/lib/server/leagues/index.ts` already owns the TTL logic, the `inFlight` coalescing, and the
lazy per-team `loadRoster()` flow. Storage sits behind that boundary, so moving rosters to memory
is a swap of the backend underneath that file, estimated at half a day — and because
`better-sqlite3` reads are already synchronous, in-memory `Map` reads are a drop-in. That estimate
is the same in six months: rosters are ~3,000 rows of derived data whenever you migrate. Nothing
accumulates that makes the swap harder.

What moving rosters to memory changes: nothing survives a restart, so each deploy re-warms lazily
from upstream — the five team lists on the first home-page hit, then rosters one team at a time on
demand. It is a simplification, **not spike preparation**: SQLite reads are already
sub-millisecond and in-process, and are not what falls over at 30 req/s.

The work that _did_ get more expensive with delay went first, and is done: licensing and
attribution, runtime validation of the league feeds, and settling the `events` schema while it
held two days of data rather than ninety. Telemetry growth is bounded where it is, by the 90-day
cutoff and a 500,000-row ceiling in `analytics.ts`; an unbounded table is unbounded on any
backend, so that was never a reason to change backends.

**Revisit if user accounts or persisted scores are added.** Durability requirements change at that
point, and [Fly Managed Postgres](https://fly.io/docs/mpg/) ($38/mo, Basic) enters the picture.

### On privacy, which points the same way

Counterintuitively, moving telemetry to a hosted provider makes the privacy position **harder**,
not easier. The current implementation — a daily-rotated salt that is never written to disk, no
cookies, host-only referrers, 90-day retention, nothing leaving the infrastructure except error
alerts — is the basis on which cookieless analytics tools claim they need no consent banner. A US
processor adds a DPA, a transfer mechanism, and a processing record, and most error trackers
capture IP addresses by default unless configured otherwise.

### What no option fixes

Two per-process constraints survive in B, C, and D alike, and are worth knowing before "stateless"
is read as "unconstrained":

1. **N machines means N× independent upstream syncs** — and N× hourly sweeps, since `startSweeps`
   runs per process. Negligible at N=3, not at N=20, where a shared warm store becomes worth
   revisiting. The CHL HockeyTech key in `src/lib/server/leagues/chl.ts` is shared across
   consumers and worth not hammering.
2. **In-memory rate limiting becomes per-instance.** A limiter on three machines is a 3× looser
   limit. Fine at this scale.

Neither is a reason to avoid scaling. Both are reasons the CDN remains the better answer to a
spike than horizontal scaling is, regardless of where the data lives.

## What it costs

| Scenario                                                          | Monthly         |
| ----------------------------------------------------------------- | --------------- |
| Scale-to-zero, ~5h/day runtime + 1GB volume (as until 2026-07-28) | **~$0.55**      |
| Always-on 256MB + 1GB volume (the current configuration)          | **~$2.09**      |
| Always-on 256MB, no volume, hosted error logging                  | **~$1.94**      |
| Always-on `shared-cpu-2x` 512MB (headroom)                        | **~$3.89**      |
| Above + self-hosted PG 256MB + 1GB volume                         | **~$6**         |
| One-day pre-scale to `shared-cpu-2x` 1GB                          | **+$0.21 once** |
| Egress for a front-page r/hockey post                             | **+$0.72 once** |

The current-configuration row is the machine and volume prices below added together, not a figure
read off an invoice.

## Fly pricing reference

Figures as of **2026-07-27**, North America / `yyz`. Pricing drifts — re-check before relying on
these.

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

**There is no free tier and no free egress allowance** on current plans. Fly's cost management
docs state plainly: _"There is no 'free account/free tier' on Fly.io."_

Sources: [resource pricing](https://fly.io/docs/about/pricing/) ·
[cost management](https://fly.io/docs/about/cost-management/) ·
[Managed Postgres](https://fly.io/docs/mpg/) · [unmanaged Postgres](https://fly.io/docs/postgres/)

## Before a large post

Everything that could be done ahead of time is done: the cache headers, the CDN, the always-on
machine, the concurrency limits and the retention bound. What is left are actions for the day, and
one setting that has to be re-checked.

1. **Check the Worker's routes still fail open, and consider Workers Paid for the month.** The
   Worker runs on every request to its routes, cache hit or not, and Workers Free allows
   [100,000 requests a day](https://developers.cloudflare.com/workers/platform/limits/) across the
   account, resetting at midnight UTC. The home page, the privacy page and every team page pass through it, so a "good post"
   (~40k visitors) reaches that at two or three pages each. What happens next is set per route in the Cloudflare dashboard: **fail open**
   bypasses the Worker and sends the request to the origin uncached, where the
   [measured ceiling](#where-it-breaks) applies again; **fail closed** serves a Cloudflare 1027
   error page. Every route in `wrangler.toml` should be set to fail open, and a Worker deploy
   resets them, so check after each one. Workers Paid is what keeps the cache in the path all day.

2. **Warm the roster cache from `/admin` minutes before posting.** A full resync takes ~1–2
   minutes and guarantees nobody arriving from Reddit waits on an 8s upstream fetch.

3. **Optionally, pre-scale the one machine.** Cheap insurance for the cache misses, with no code:

   ```sh
   fly scale vm shared-cpu-2x --vm-memory 1024    # restarts the machine
   fly scale vm shared-cpu-1x --vm-memory 256     # the next day
   ```

   One `shared-cpu-2x` / 1GB machine for 24 hours costs about **$0.21**. It has not been
   load-tested at that size, so treat the [measured ceiling](#where-it-breaks) as the floor rather
   than assuming it doubles.

   Two things in `fly.toml` go with it. A deploy applies the `[[vm]]` block again, so if one might
   happen while scaled up, change the size there instead and change it back afterwards. And the
   `[http_service.concurrency]` limits are sized for the small machine: raise them in the same
   edit if the bigger one should take more simultaneous connections, and restore them with the
   size.

> [!WARNING]
> **Scale up, never out.** `fly scale count` must not be used while the database is a file on a
> volume. A volume attaches to one machine, so for each machine it adds Fly creates a new,
> **empty** volume and [copies no data across](https://fly.io/docs/launch/scale-count/).
> `fly scale count 3` would therefore produce three machines with three separate SQLite
> databases: three sets of roster syncs, the visits split three ways, and `/admin` showing
> whichever third a request happens to land on. Scaling back down leaves the extra volumes
> unattached, with no guarantee that the machine Fly keeps is the one holding the original.
>
> Do not rely on `auto_start_machines` to absorb a spike either — it starts machines that already
> exist, and there is only the one.

## Open questions

- **Are the game-page images hot-linked?** Check the Domain column in devtools on a game page. If
  a meaningful share come from our own origin rather than `assets.nhle.com` / HockeyTech,
  game-page egress is ~180 kB rather than ~91 kB, which doubles the egress column. Doesn't change
  any conclusion — egress is under a dollar either way — but it's the one unverified input.
- **How much memory headroom is there?** Current RSS against the 256MB cap (`fly machine status`)
  has not been recorded.
- **What is the actual spend?** The Fly dashboard has not been checked against the ~$2.09
  estimate above.
