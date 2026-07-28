# NumBrrs

**NumBrrs** is a flashcard-style game for learning hockey player jersey numbers, covering the NHL, PWHL, WHL, OHL and QMJHL. Pick a league and a team, guess who wears each number, and work your way through the full roster.

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

### Deploying to Fly.io

```bash
fly launch
fly secrets set DATABASE_URL=/data/numbrrs.db
fly deploy
```

| Secret              | Description                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Path to the SQLite database file. Use `/data/numbrrs.db` with a Fly volume.                                                                               |
| `ADMIN_TOKEN`       | Password for the `/admin` dashboard, which is also what authorises a manual resync. Rotating it signs everyone out. Generate with `openssl rand -hex 32`. |
| `ALERT_WEBHOOK_URL` | Discord webhook that server, client and sync errors are pushed to. Errors are still recorded to the database while unset.                                 |

Rosters refresh on demand — 12 hours per team, 24 hours per team list — so there
is nothing to schedule. To push new data out immediately, use the resync button on
`/admin`; it starts a full refresh in the background and the page reports progress
as it lands.

### Usage tracking

`/admin` shows visits per day, top teams, referrers, the language split, and
recent errors. Everything is first-party: pageviews are recorded server-side in
`hooks.server.ts`, and a visitor is identified by a hash of a salt that rotates
daily and is never persisted — so counts are per day and nobody can be followed
across them. No cookie, no third-party script, nothing leaves the machine.

### Running the production build locally

`vite dev` needs nothing extra, but the built server derives its origin from the
`Host` header and assumes `https`, so form posts (the `/admin` login) fail the
cross-site check over plain http. Set `ORIGIN` to match:

```bash
DATABASE_URL=scratch.db ADMIN_TOKEN=dev ORIGIN=http://localhost:3000 node build
```

### Scaling

The app runs as a single machine, and that is the only correct configuration
today. Three things assume it: the Fly volume holding SQLite attaches to exactly
one machine, the sync layer's in-flight coalescing is per-process, and the rate
limiter is in memory. Running `fly scale count 2` would not fail loudly — it
would quietly duplicate syncs and loosen the limits.

The exit paths, when it matters, are LiteFS for read replicas or Postgres via a
Drizzle dialect swap. See [`docs/hosting.md`](docs/hosting.md) for the full
analysis, including why the storage layout is what it is.

## Documentation

- [`docs/code-review/`](docs/code-review/) — the hardening backlog: prioritised
  findings with `file:line` evidence and status boxes.
- [`docs/hosting.md`](docs/hosting.md) — what it costs to run, what a large
  traffic spike would do to it, and the storage decisions behind both.

## License

[MIT](LICENSE) — **source code only**.

Team names, logos and marks belong to their respective clubs and leagues and are
used here for identification. This project is not affiliated with or endorsed by
the NHL, PWHL, WHL, OHL or QMJHL. Fonts ship under the SIL Open Font License and
icons under ISC.

See [NOTICE](NOTICE) for the full attribution, and
[the privacy page](https://numbrrs.app/privacy) for what the site records.
