# Numbrrs

**Numbrrs** is a flashcard-style game for learning hockey player jersey numbers, covering the NHL, PWHL, WHL, OHL and QMJHL. Pick a league and a team, guess who wears each number, and work your way through the full roster.

The whole site is available in English and French — each language has its own URLs (`/` and `/fr/`), so both are indexable and shareable.

## How it works

You're shown a hockey card with a team and jersey number. Guess the player from the options highlighted in the roster — then the card flips to reveal whether you got it right.

- **Learn** — 3 choices, open book
- **Easy** — 5 choices, bronze medal
- **Medium** — 10 choices, silver medal
- **Hard** — the entire roster, gold medal

Learn is for getting to know a team: players you identify are marked in the roster with their numbers and stop appearing as options, so it gets easier as you go. The other three are quizzes. The roster shows no numbers, every card offers the full count of names however many players you've found, and a run with no misses earns the level's medal. At every level a missed card comes back a few cards later, and you play until the whole roster is found.

Roster data is pulled from the league APIs — the NHL's own feed, and HockeyTech's for the other four — and refreshed on demand as pages are visited, so it stays up to date as trades and signings happen. Each league is wired up through a small adapter (`src/lib/server/leagues/`), so adding another league mostly means writing a new adapter.

## Contributing

Contributions are welcome! If you spot a bug, have an idea, or want to improve the team colours, feel free to:

- [Open an issue](https://github.com/jamincan/numbrrs/issues) to report a bug or suggest a feature
- [Submit a pull request](https://github.com/jamincan/numbrrs/pulls) with your changes

### Running locally

```bash
pnpm install
pnpm dev
```

### Running the production build locally

`vite dev` needs nothing extra, but the built server needs two things to reach
`/admin`. It derives its origin from the `Host` header and assumes `https`, so form
posts (the `/admin` login) fail the cross-site check over plain http. Set `ORIGIN`
to match. It also requires a Cloudflare Access token on `/admin`, so set
`ADMIN_DIRECT=1` to skip that. A server started with that switch raises an alert
saying so, which is the point of it in production and noise here, hence the
blank `ALERT_WEBHOOK_URL`: it keeps a webhook exported in the shell out of it.

```bash
DATABASE_URL=scratch.db ADMIN_TOKEN=dev ADMIN_DIRECT=1 ALERT_WEBHOOK_URL= ORIGIN=http://localhost:3000 node build
```

## Hosting

The site is one Fly.io machine in Toronto (`yyz`) with SQLite on a volume mounted
at `/data`. Cloudflare sits in front of it: it proxies `numbrrs.app` and runs a
small Worker that caches team pages per language. Setting up a copy from scratch:

```bash
fly launch
fly secrets set ADMIN_TOKEN=$(openssl rand -hex 32)
fly deploy
```

| Secret              | Description                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADMIN_TOKEN`       | Password for the `/admin` dashboard, which is also what authorises a manual resync. Rotating it signs everyone out. Generate with `openssl rand -hex 32`. |
| `ALERT_WEBHOOK_URL` | Discord webhook that server, client and sync errors are pushed to. Errors are still recorded to the database while unset.                                 |
| `ADMIN_DIRECT`      | Emergency switch, normally unset. `1` has `numbrrs.fly.dev` serve the site and `/admin` skip Cloudflare Access while Cloudflare is down; see below.       |

`DATABASE_URL`, the path to the SQLite file, is not a secret: `fly.toml` sets it
to `/data/numbrrs.db` on the volume. A Fly secret of the same name overrides it.

Rosters go stale after 12 hours, team lists after 24. An hourly sweep inside the
app refreshes whatever has passed its limit, so every roster is re-fetched at
least once a day whether or not anyone opens it; a visit to a stale team still
refreshes it on the spot. Nothing external to schedule — the sweep relies on
`min_machines_running = 1` in `fly.toml`, since a stopped machine has no timers.
To push new data out immediately, use the resync button on `/admin`; it starts a
full refresh in the background and the page reports progress as it lands.

### Usage tracking

`/admin` shows visits per day, top teams, referrers, the language split, and
recent errors. The analytics are first-party: pageviews are recorded server-side
in `hooks.server.ts`, and a visitor is identified by a hash of their IP address
and user agent with a salt that rotates daily and is never persisted — so counts
are per day and nobody can be followed across them. No analytics cookie, no
third-party script.

That is not the same as nothing leaving the machine. Every request passes
through Cloudflare and Fly, error alerts go to Discord, and browsers fetch
headshots, and any logo the site does not host itself, straight from the
leagues' and HockeyTech's image servers.
[The privacy page](https://numbrrs.app/privacy) says so; keep it in step with
the code when any of this changes.

The home page, `/privacy` and every `/game/…` page are served from the Worker's
cache for up to five minutes at a time, and a cache hit never reaches the
machine. So the Worker reports those views itself: it gathers them and posts
them to `/api/hit`, up to 25 at a time or every ten seconds, signed with
`EDGE_TOKEN`, and the origin records each one as it would have recorded a page
it rendered, marked as the edge's (`events.served_by`). The dashboard's "Edge
cache and server" panel shows the split, which is also the quickest check that
the Worker is reporting at all: a cache-only visitor count of zero on a busy
day means it is not. A batch is lost if the Worker is evicted before it sends or
the post fails, so under load the numbers run slightly low. If `EDGE_TOKEN` is
missing on either side nothing is reported, and the dashboard falls back to
counting cache misses only.

## Operations

Everything here is run by hand from a checkout, with `flyctl` and `gh` signed in.

### Deploy

```bash
pnpm run deploy            # pnpm run deploy --dry-run does the checks and stops
```

`scripts/deploy.mjs` refuses to go ahead unless the working tree is clean, the
branch is `master`, `HEAD` is the tip of `origin/master`, and CI passed for that
commit (it waits if the run is still going). It then runs `flyctl deploy` with
the image labelled `git-<sha>` and checks what came up: `/api/health`, the home
page and a game page on `numbrrs.app`; then, asking Fly directly at
`numbrrs.fly.dev`, that `/api/health` answers, that `/admin` redirects to
`numbrrs.app/admin` (a 200 there means `ADMIN_DIRECT` is still set), and that
`/admin` is refused with a 403 when the request names `numbrrs.app` as its host.
Plain `flyctl deploy` does none of that — it ships whatever is in the working
directory, committed or not.

Around a deploy:

- **Before, if it adds a file to `drizzle/`:** take a volume snapshot. Migrations
  run when the server boots and nothing un-applies them. See
  [`docs/restore.md`](docs/restore.md#before-a-deploy-that-migrates).
- **After, always:** purge the Cloudflare cache (dashboard → Caching →
  Configuration → Purge Everything). Pages cached at the edge still name the
  previous build's hashed files under `/_app/immutable/`, which the new image
  does not contain, so until they expire they can load without their scripts.
- **After, if the commit touched the Worker:** deploy it too — next section.

### Roll back

```bash
flyctl releases --image -a numbrrs            # each release and its image
flyctl deploy --image <image reference> -a numbrrs
```

Run it from a checkout of the commit being rolled back to, so `fly.toml` matches
the image — for a release the deploy script made, the `git-<sha>` label says
which commit that is — then purge the cache again.

Migrations are forward-only, so the older code meets the newer schema. That is
safe only when what the newer release added was purely additive — a new table,
index or nullable column. If it renamed, dropped or rebuilt anything, restore
the snapshot taken before the deploy
([`docs/restore.md`](docs/restore.md#path-b--restore-a-snapshot)) rather than
rolling back the image alone.

### The Cloudflare Worker

```bash
pnpm run cf:deploy         # wrangler deploy, configured by wrangler.toml
```

The Worker (`numbrrs-locale-cache`) deploys separately from the app, and a Fly
deploy never updates it. Redeploy it whenever `cloudflare/locale-cache-worker.ts`
or `wrangler.toml` changes, and whenever the locale code it imports from
`src/lib/i18n/index.ts` does (`negotiateLocale`, `localeFromPath`,
`LOCALE_COOKIE`) — otherwise the edge sorts visitors into its per-language cache
slots by rules the origin no longer follows. The same goes for the league rule
in `src/lib/leagues.ts` (`resolveLeague`), which decides which copy of the home
page a visitor gets, and for `src/lib/edge-hits.ts`, the shape of the page-view
reports.

The Worker holds one secret, `EDGE_TOKEN`, which must equal the Fly secret of
the same name:

```bash
pnpm exec wrangler secret put EDGE_TOKEN
```

Without it the Worker still caches; it just reports no page views.

English home-page URLs that carry a query string (`/?utm_…`, `/?league=pwhl`) do
not pass through the Worker: a route pattern cannot contain a query string, and
the only pattern that would match them is `numbrrs.app/*`, which would put every
asset request through the Worker and its daily request limit. The origin renders
and counts those itself.

**After every Worker deploy, set each route back to fail open.** A deploy resets
every route's failure mode, and neither `wrangler.toml` nor Cloudflare's routes
API has a setting for it: Cloudflare dashboard → Workers & Pages →
`numbrrs-locale-cache` → Settings → Domains & Routes, then each route in turn.
Left at fail closed, every game page becomes a Cloudflare 1027 error page once
the account passes its daily request limit.

To take it out of the path, delete its routes: Cloudflare dashboard → Workers &
Pages → `numbrrs-locale-cache` → Settings → Domains & Routes. Requests then go
straight to the origin, which makes every language and caching decision itself;
the site stays correct and loses only the edge cache. `pnpm run cf:deploy` puts
the routes in `wrangler.toml` back.

### Uptime monitoring

A second Worker, `numbrrs-uptime` (`cloudflare/uptime-worker.ts`, configured by
`wrangler.uptime.toml`), looks at the site from Cloudflare every five minutes and
posts to Discord when a check starts failing and when it stops. It has no routes,
so no visitor's request passes through it, and deploying it cannot touch the
cache Worker.

| Each run asks for            | and it is a failure when                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `numbrrs.fly.dev/api/health` | the machine does not answer, or cannot read its database.                                                                                                                                                                                                                                                                                                        |
| `numbrrs.fly.dev/api/status` | a check in it failed (database read, database write, disk, rosters, alerts); under 15% of the volume is free; the oldest roster is more than 15 hours old (the 12-hour TTL plus 3), which is what a stopped sweep looks like; the app has no alert webhook, or its last alert in the past day did not post; or the machine has restarted three times in an hour. |
| `numbrrs.app/`               | the answer is not a 200 with the app's own page in it, or the page carries Cloudflare's analytics script (`cloudflareinsights`), which the privacy page says it does not.                                                                                                                                                                                        |
| `numbrrs.app/privacy`        | the same, for a page that comes through the cache Worker: a Worker that throws, or a 1027 page from a route left at fail closed.                                                                                                                                                                                                                                 |

What the messages mean:

- **uptime monitor started** — the first run after setup, with what it found.
  This is the proof that the Worker can reach Discord.
- **a check is failing** — it has failed two runs in a row, so five to ten
  minutes after it broke. One failed run is not announced, which is what keeps a
  deploy's restart quiet.
- **still failing** — a reminder: 3 hours after the first message, 6 hours after
  that, then once a day.
- **recovered** — it has passed two runs in a row, with how long it was failing.
- **the monitor cannot keep its state** — Workers KV, where it remembers what it
  has already said, is not answering. It lists what is failing every half hour
  until KV is back.

Setup, in this order. Every command needs `-c wrangler.uptime.toml`; without it
wrangler acts on the cache Worker. The first step is done for this Cloudflare
account (the namespace exists and its id is in `wrangler.uptime.toml`), and is
only needed again on a different account.

```bash
pnpm exec wrangler kv namespace create numbrrs-uptime-state -c wrangler.uptime.toml
# answer no if it offers to add the binding; put the id it prints in the
# [[kv_namespaces]] block of wrangler.uptime.toml and commit that
pnpm run cf:deploy:uptime
pnpm exec wrangler secret put ALERT_WEBHOOK_URL -c wrangler.uptime.toml
# paste a Discord webhook URL
```

Until the secret is set the Worker runs and logs what it finds, but has nowhere
to post.

The Cloudflare account needs a `workers.dev` subdomain before a Cron Trigger
can be created, even though this Worker has no address on it. Without one the
deploy uploads the Worker and then fails on the schedule with error 10063;
opening Workers & Pages in the dashboard and choosing a subdomain fixes it, and
the deploy can be run again.

The "started" message should arrive within twenty minutes: a new Cron Trigger
can take fifteen to reach Cloudflare's network. Redeploy with
`pnpm run cf:deploy:uptime` whenever the Worker's file or config changes; a Fly
deploy never updates it.

To see a run without waiting for one, `pnpm exec wrangler dev -c wrangler.uptime.toml`
and, in another terminal, `curl http://localhost:8787/cdn-cgi/local/scheduled`.
That probes the live site from your machine and logs what it would have posted;
it posts nothing unless a `.dev.vars` file supplies the webhook. To make the
deployed Worker introduce itself again, and so test the path to Discord, delete
what it remembers:

```bash
pnpm exec wrangler kv key delete state --binding UPTIME_STATE --remote -c wrangler.uptime.toml
```

To silence it for planned maintenance, set a key that expires by itself. While
it exists the monitor does nothing, and afterwards it carries on from where it
was, so nothing has to be remembered. Set it a few minutes ahead, since KV can
take a minute to show a new key, and delete `silence` the same way as `state` to
end it early.

```bash
pnpm exec wrangler kv key put silence 1 --ttl 3600 --binding UPTIME_STATE --remote -c wrangler.uptime.toml
```

What it cannot see:

- **Itself.** If the Cron Trigger stops firing, the Worker is over its limits, or
  the webhook is revoked, nothing says so, and a quiet channel looks the same as
  a healthy site. Each run logs one line under Workers & Pages → `numbrrs-uptime`
  → Observability; that is where to check that it is running.
- **Anything shorter than about ten minutes**, or anything that fails for some
  visitors only: it asks from one Cloudflare location, for two pages. A broken
  game page is the app's own alerts' to report.
- **Why a roster is old.** The roster check fires on the oldest one, so a single
  team whose feed stays broken holds it open; the message gives the stale count
  to tell that from a sweep that has stopped.

### `/admin` and Cloudflare Access

Cloudflare Access guards `numbrrs.app/admin`, and the app enforces it as well:
every `/admin` request must carry a token signed by Access for this application,
or it gets a 403. That's what stops a direct connection to Fly that names
`numbrrs.app` as its host from walking around Access. The token login still
applies on top. The team domain and the application's AUD tag are in
`src/lib/server/cloudflare-access.ts`. Recreating the Access application changes
the AUD tag, so update it there.

Fly's own hostname, `numbrrs.fly.dev`, reaches the app without passing through
Cloudflare, so it is not a second copy of the site: the app answers everything
asked of it with a 308 to the same URL on `numbrrs.app`, `/admin` included. The
exceptions are `/api/health` and `/api/status`, which Fly's health check, the
deploy script and the uptime probe ask the machine itself.

If Cloudflare is down, `numbrrs.app` is unreachable and Access can't sign anyone
in. One switch covers both:

```bash
flyctl secrets set ADMIN_DIRECT=1 -a numbrrs    # restarts the machine
# the site is now served at https://numbrrs.fly.dev, and /admin there asks only for the token
flyctl secrets unset ADMIN_DIRECT -a numbrrs    # once Cloudflare is back
```

While the switch is on, `numbrrs.fly.dev` serves the whole site itself instead of
redirecting, and `/admin` skips the Access check on every hostname. `/admin`
shows a warning banner, the server logs one at startup, and every start also
raises an alert (`boot:admin-direct` on the dashboard). Discord is pinged for
the start that turned the switch on, and after that for any start more than an
hour after the last ping: a run of restarts is one ping, and a later deploy with
the switch still on is a reminder. Nothing repeats it while the machine simply
stays up, so unsetting it is still yours to remember.

### Request limit

Each address gets 120 requests a minute for anything the app has to work for —
pages, their data, and URLs that match nothing — and a `429` with `Retry-After`
beyond that. `/api/health`, `/api/status`, `/api/hit`, `/api/client-error` and
`/admin` are not counted; neither are the built scripts, styles and fonts, which
are served as files before the app's own code runs. The count is per visitor
even behind Cloudflare, held in memory, and forgotten at a restart. An address
over the limit shows up in `flyctl logs` as one `[rate-limit]` line a minute,
and never as an alert. The numbers are `PAGE_RATE_LIMIT` in
`src/lib/server/request-policy.ts`.

### Backups and restore

Fly snapshots the volume daily. What is worth restoring, how to do it, how to
rehearse it, and how to pull a copy of the production database safely are in
[`docs/restore.md`](docs/restore.md).

### Scaling

The app runs as a single machine, and that is the only correct configuration
today. Three things assume it: SQLite lives on a Fly volume, which attaches to
exactly one machine; the sync layer's in-flight coalescing is per-process; and
the rate limiter is in memory.

Do not run `fly scale count`. Fly gives each machine it adds
[a new, empty volume and copies nothing across](https://fly.io/docs/launch/scale-count/),
so `fly scale count 2` means two separate databases: each machine fetches its
own rosters and records its own share of the visits, and `/admin` shows
whichever half the request happens to land on. Scaling back down leaves one
volume unattached, and nothing guarantees the machine that survives is the one
holding the history.

For a busy day, make the one machine bigger instead:

```bash
flyctl scale vm shared-cpu-2x --vm-memory 1024 -a numbrrs    # restarts the machine
flyctl scale vm shared-cpu-1x --vm-memory 256 -a numbrrs     # afterwards
```

`fly.toml` wins at the next deploy — its `[[vm]]` block resets the size — so if a
deploy might happen while scaled up, change `[[vm]]` there instead and change it
back afterwards. The `[http_service.concurrency]` limits in the same file are
sized for the small machine; raise them in the same edit if the bigger one
should take more simultaneous connections.

The way out of single-machine, when it matters, is the one
[`docs/hosting.md`](docs/hosting.md#storage-architecture) settles on: rosters held
in memory and telemetry in a managed store, which leaves the app stateless.

### Settings that live only in dashboards

Nothing in the repo records these, and nothing in it would recreate them.
"Verify" marks a value that could not be read when this table was written —
check it rather than trusting the table.

| Where                                                 | Setting                            | Should be                                                                                                                                                                                                                           |
| ----------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare → DNS                                      | `numbrrs.app` records              | Proxied, pointing at the Fly app. Verify.                                                                                                                                                                                           |
| Cloudflare → SSL/TLS                                  | Encryption mode                    | Full (strict). Verify.                                                                                                                                                                                                              |
| Cloudflare → Zero Trust → Access                      | Application on `numbrrs.app/admin` | Present, with the team domain and AUD tag that `src/lib/server/cloudflare-access.ts` expects. Who its policy admits: verify.                                                                                                        |
| Cloudflare → Caching → Configuration                  | Browser Cache TTL                  | Respect Existing Headers. Any other value overrides the pages' `max-age=0`, and browsers then keep a page across a deploy, where no purge reaches it. Verify.                                                                       |
| Cloudflare → Web Analytics                            | The injected RUM beacon            | Off for `numbrrs.app`. The privacy page says there are no third-party analytics, and that is only true while this is off. Verify.                                                                                                   |
| Cloudflare → Workers & Pages → `numbrrs-locale-cache` | Routes                             | Those in `wrangler.toml`.                                                                                                                                                                                                           |
| Cloudflare → Workers & Pages → `numbrrs-locale-cache` | Each route's failure mode          | Fail open, so that past the plan's daily request limit visitors go straight to the origin instead of getting a Cloudflare 1027 error page. Reset by every `pnpm run cf:deploy`; set it again afterwards.                            |
| Cloudflare → Workers & Pages                          | Plan                               | Workers Free: 100,000 requests a day across the account, resetting at midnight UTC. Every `/privacy` and `/game/…` request counts, cache hit or not.                                                                                |
| Cloudflare → Workers & Pages → `numbrrs-uptime`       | Cron Trigger and KV binding        | Every five minutes, with `UPTIME_STATE` bound to the namespace whose id is in `wrangler.uptime.toml`. No routes, no workers.dev address. All of it is put back by `pnpm run cf:deploy:uptime`.                                      |
| Cloudflare → Workers & Pages → `numbrrs-uptime`       | Secret `ALERT_WEBHOOK_URL`         | Set, to a Discord webhook. Nothing in the repo holds it; `pnpm exec wrangler secret list -c wrangler.uptime.toml` shows names only.                                                                                                 |
| Fly → app `numbrrs`                                   | Secrets                            | `ADMIN_TOKEN` and `ALERT_WEBHOOK_URL`; `ADMIN_DIRECT` absent. A `DATABASE_URL` secret left from before `fly.toml` carried the path is harmless while it says `/data/numbrrs.db`. `flyctl secrets list -a numbrrs` shows names only. |
| Fly → volume `vol_vjyk76mg6yz027zv`                   | Snapshot schedule and retention    | Daily, kept 5 days (Fly's default). `flyctl volumes show vol_vjyk76mg6yz027zv -a numbrrs`; change with `flyctl volumes update vol_vjyk76mg6yz027zv --snapshot-retention <days> -a numbrrs`.                                         |
| Fly → app `numbrrs`                                   | Certificates                       | One for `numbrrs.app`, and one for each host the app redirects from (`REDIRECT_HOSTNAMES` in `src/lib/site.ts`) that should still answer. `flyctl certs list -a numbrrs`. Verify.                                                   |

## Documentation

- [`docs/README.md`](docs/README.md) — the index: what each document is and how
  current it is.
- [`docs/restore.md`](docs/restore.md) — backups, restoring the database, and the
  restore drill.
- [`docs/hosting.md`](docs/hosting.md) — what it costs to run, what a large
  traffic spike would do to it, and the storage decisions behind both.
- [`docs/audit-2026-11.md`](docs/audit-2026-11.md) — the current backlog, from
  the November 2026 audit.
- [`docs/decisions.md`](docs/decisions.md) — the choices that are not obvious
  from the code, each with its date and its reason.

## License

[MIT](LICENSE) — **source code only**.

Team names, logos and marks belong to their respective clubs and leagues and are
used here for identification. This project is not affiliated with or endorsed by
the NHL, PWHL, WHL, OHL or QMJHL. Fonts ship under the SIL Open Font License and
icons under ISC.

See [NOTICE](NOTICE) for the full attribution, and
[the privacy page](https://numbrrs.app/privacy) for what the site records.
