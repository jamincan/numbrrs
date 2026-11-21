# Numbrrs documentation

## What's here

- [`restore.md`](./restore.md) — backups: what is worth restoring, the two ways to bring the
  database back, the restore drill, and how to pull a copy of production safely. Operational;
  keep it current.
- [`decisions.md`](./decisions.md) — choices that are not obvious from the code, each with its
  date and its reason: why the `/admin` session is hand-rolled, why storage is SQLite on one
  volume, why analytics cannot answer cross-day questions, and others. Read it before reopening
  any of them.
- [`hosting.md`](./hosting.md) — what the app costs to run, what a large Reddit post would do to
  it (with the measured ceiling of the origin), the storage-architecture reasoning, and what is
  left to do on the day of a large post. An analysis first written on 2026-07-27; later
  measurements carry their own dates, and its prices drift.
- [`audit-2026-11.md`](./audit-2026-11.md) — the plan of action from the November 2026 audit.
  **This is the current backlog.** A point-in-time document: once it is worked through, move what
  should outlive it into `decisions.md` and delete it.

Day-to-day operations — deploying, rolling back, the Cloudflare Worker, the `/admin` break-glass
switch, and the settings that exist only in dashboards — are in the
[top-level README](../README.md#operations).

## Picking up the work

1. Read [`audit-2026-11.md`](./audit-2026-11.md): the findings by workstream, their priorities,
   and the lists of owner actions and open decisions at the end.
2. Pick a finding. Each one names the files and lines it concerns and the fix proposed.
3. Verify the `file:line` references before acting on them. They were accurate at `ea70ed3` and
   drift as the code changes.
4. Mark its status, and note anything you found that the audit got wrong.

## Earlier reviews

The July 2026 hardening review lived in `docs/code-review/` until it was worked through. Its
decisions are in [`decisions.md`](./decisions.md); its findings are in git history
(`git show 09bde2a:docs/code-review/README.md`).
