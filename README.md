# NumBrrs

**NumBrrs** is a flashcard-style game for learning NHL player jersey numbers. Pick a team, guess who wears each number, and work your way through the full roster.

## How it works

You're shown a hockey card with a team and jersey number. Guess the player from the options highlighted in the roster — then the card flips to reveal whether you got it right.

- **Easy** — 2 choices
- **Medium** — 4 choices
- **Hard** — 8 choices
- **Expert** — the entire roster

Correctly identified players are marked in the roster and won't appear as options again, so the game gets progressively easier as you learn the team.

Roster data is pulled from the NHL API and refreshed daily, so it stays up to date as trades and signings happen.

## Contributing

Contributions are welcome! If you spot a bug, have an idea, or want to improve the team colours, feel free to:

- [Open an issue](https://github.com/jamincan/numbrrs/issues) to report a bug or suggest a feature
- [Submit a pull request](https://github.com/jamincan/numbrrs/pulls) with your changes

### Running locally

```bash
pnpm install
pnpm dev
```

## License

[MIT](LICENSE)
