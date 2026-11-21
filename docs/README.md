# Numbrrs documentation

## What's here

- [`restore.md`](./restore.md) — backups: what is worth restoring, the two ways to bring the
  database back, the restore drill, and how to pull a copy of production safely. Operational;
  keep it current.
- [`hosting.md`](./hosting.md) — what the app costs to run, what a large Reddit post would do to
  it, and the storage-architecture decision behind staying on SQLite. A dated analysis
  (2026-07-27) with later revisions marked inline.
- [`audit-2026-11.md`](./audit-2026-11.md) — the plan of action from the November 2026 audit.
  **This is the current backlog.**
- [`code-review/`](./code-review/) — the July 2026 hardening review. Findings are prioritised,
  carry `file:line` evidence, and have status boxes. It has been worked through; what remains
  useful is the reasoning behind its decisions.

Day-to-day operations — deploying, rolling back, the Cloudflare Worker, the `/admin`
break-glass switch, and the settings that exist only in dashboards — are in the
[top-level README](../README.md#operations).

## The July review: scope and staleness

The review was performed on **2026-07-27** against commit
[`631b649`](https://github.com/jamincan/numbrrs/commit/631b649) ("Serve the roster from one
drawer at every size"). It received a **status pass the same day against `ff92fdf`**, once the
telemetry and admin dashboard work had landed.

It is a **point-in-time review, not permanent architecture documentation**. It describes the
codebase as it stood on that date. Once the findings are worked through, this directory should
either be deleted or replaced with docs that describe the app rather than a moment in its
history — the failure mode for documents like these is quietly rotting into a description of a
codebase that no longer exists.

> [!NOTE]
> The review originally excluded the structured logging and admin dashboard work, which was
> unpushed at the time. **That gap is now closed.** The dashboard landed in `586b5e4` / `ff92fdf`
> and has been reviewed: see
> [Re-review: resolved](./code-review/README.md#re-review-resolved-2026-07-27) for what each
> deferred conclusion turned out to be, and
> [privacy and telemetry](./code-review/10-privacy-and-telemetry.md) for the pass over what the
> logs capture.

### Decisions recorded here rather than re-derived

Two questions were settled on 2026-07-27 and should not be reopened without new information:

- **The admin session layer stays hand-rolled.** Lucia is no longer a library, Oslo is a
  primitives package that would wrap Node's stdlib rather than replace it, and the account-based
  libraries model a problem this app does not have. Reasoning in
  [the re-review](./code-review/README.md#re-review-resolved-2026-07-27). Cloudflare Access was
  later put in front of `/admin` as a second layer (`ea70ed3`); the session code stayed as it
  was beneath it.
- **Storage stays on SQLite for now.** In-memory rosters plus a separate telemetry store is the
  intended end state, but the migration cost does not compound, so it is deliberately deferred
  behind the hardening work. Reasoning in [`hosting.md`](./hosting.md#storage-architecture).

## Picking up the work

1. Read [`audit-2026-11.md`](./audit-2026-11.md): the findings by workstream, their priorities,
   and the lists of owner actions and open decisions at the end.
2. Pick a finding. Each one names the files and lines it concerns and the fix proposed.
3. Verify the `file:line` references before acting on them. They were accurate at `ea70ed3` and
   drift as the code changes.
4. Mark its status, and note anything you found that the audit got wrong.
