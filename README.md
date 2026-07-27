# NumBrrs

**NumBrrs** is a flashcard-style game for learning hockey player jersey numbers, covering the NHL and the PWHL. Pick a league and a team, guess who wears each number, and work your way through the full roster.

## How it works

You're shown a hockey card with a team and jersey number. Guess the player from the options highlighted in the roster — then the card flips to reveal whether you got it right.

- **Easy** — 2 choices
- **Medium** — 4 choices
- **Hard** — 8 choices
- **Expert** — the entire roster

Correctly identified players are marked in the roster and won't appear as options again, so the game gets progressively easier as you learn the team.

Roster data is pulled from the league APIs (the NHL API and the PWHL's HockeyTech feed) and refreshed regularly, so it stays up to date as trades and signings happen. Each league is wired up through a small adapter (`src/lib/server/leagues/`), so adding another league mostly means writing a new adapter.

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

| Secret              | Description                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`      | Path to the SQLite database file. Use `/data/numbrrs.db` with a Fly volume.                                               |
| `SYNC_TOKEN`        | Bearer token for `POST /api/sync`. The endpoint returns 503 while unset.                                                  |
| `ADMIN_TOKEN`       | Password for the `/admin` usage dashboard. Rotating it signs everyone out. `/admin` says it's unconfigured while unset.   |
| `ALERT_WEBHOOK_URL` | Discord webhook that server, client and sync errors are pushed to. Errors are still recorded to the database while unset. |

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

## License

[MIT](LICENSE)
