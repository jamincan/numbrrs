# Numbrrs

**Numbrrs** is a flashcard-style game for learning hockey player jersey numbers, covering the NHL, PWHL, WHL, OHL and QMJHL. Pick a league and a team, guess who wears each number, and work your way through the full roster.

The whole site is available in English and French — each language has its own URLs (`/` and `/fr/`), so both are indexable and shareable.

## How it works

You're shown a hockey card with a team and jersey number. Guess the player from the options highlighted in the roster — then the card flips to reveal whether you got it right.

- **Easy** — 2 choices
- **Medium** — 4 choices
- **Hard** — 8 choices
- **Expert** — the entire roster

Correctly identified players are marked in the roster and won't appear as options again, so the game gets progressively easier as you learn the team.

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
`ADMIN_DIRECT=1` to skip that:

```bash
DATABASE_URL=scratch.db ADMIN_TOKEN=dev ADMIN_DIRECT=1 ORIGIN=http://localhost:3000 node build
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
| `ADMIN_DIRECT`      | Emergency switch, normally unset. `1` lets `/admin` skip the Cloudflare Access check while Cloudflare is down; see below.                                 |

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

The numbers are what the origin saw, which is less than what happened. `/privacy`
and every `/game/…` page are served from the Worker's cache for up to five
minutes at a time, and a cache hit never reaches the machine, so it records
nothing. The home page is never cached, so visits that start there are counted;
someone who arrives straight on a cached team page is not counted until they
reach a page the origin serves, and "top teams" is closer to a count of cache
misses than of views. Read it as a ranking, not a total.

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
page and a game page on `numbrrs.app`, and a 403 from `numbrrs.fly.dev/admin`.
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
slots by rules the origin no longer follows.

To take it out of the path, delete its routes: Cloudflare dashboard → Workers &
Pages → `numbrrs-locale-cache` → Settings → Domains & Routes. Requests then go
straight to the origin, which makes every language and caching decision itself;
the site stays correct and loses only the edge cache. `pnpm run cf:deploy` puts
the routes in `wrangler.toml` back.

### `/admin` and Cloudflare Access

Cloudflare Access guards `numbrrs.app/admin`, and the app enforces it as well:
every `/admin` request must carry a token signed by Access for this application,
or it gets a 403. That's what stops `numbrrs.fly.dev/admin`, or a direct
connection to Fly, from walking around Access. The token login still applies on
top. The team domain and the application's AUD tag are in
`src/lib/server/cloudflare-access.ts`. Recreating the Access application changes
the AUD tag, so update it there.

If Cloudflare is down, Access can't sign anyone in. To get into `/admin` anyway:

```bash
flyctl secrets set ADMIN_DIRECT=1 -a numbrrs    # restarts the machine
# sign in at https://numbrrs.fly.dev/admin with the token
flyctl secrets unset ADMIN_DIRECT -a numbrrs    # once Cloudflare is back
```

While the switch is on, `/admin` shows a warning banner and the server logs one at
startup.

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
| Cloudflare → Workers & Pages → `numbrrs-locale-cache` | Each route's failure mode          | Fail open, so that past the plan's daily request limit visitors go straight to the origin instead of getting a Cloudflare 1027 error page. Verify.                                                                                  |
| Cloudflare → Workers & Pages                          | Plan                               | Workers Free: 100,000 requests a day across the account, resetting at midnight UTC. Every `/privacy` and `/game/…` request counts, cache hit or not.                                                                                |
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
- [`docs/code-review/`](docs/code-review/) — the July 2026 hardening review,
  since worked through; kept for its reasoning.

## License

[MIT](LICENSE) — **source code only**.

Team names, logos and marks belong to their respective clubs and leagues and are
used here for identification. This project is not affiliated with or endorsed by
the NHL, PWHL, WHL, OHL or QMJHL. Fonts ship under the SIL Open Font License and
icons under ISC.

See [NOTICE](NOTICE) for the full attribution, and
[the privacy page](https://numbrrs.app/privacy) for what the site records.
