# NumBrrs documentation

## What's here

- [`code-review/`](./code-review/) — a hardening review of the codebase, published as a
  trackable backlog. Findings are prioritised, carry `file:line` evidence, and have status
  boxes so work can be picked up and checked off across sessions.
- [`hosting.md`](./hosting.md) — what the app costs to run, what a large Reddit post would do to
  it, and the storage-architecture decision behind staying on SQLite.

## Scope and staleness

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
  [the re-review](./code-review/README.md#re-review-resolved-2026-07-27).
- **Storage stays on SQLite for now.** In-memory rosters plus a separate telemetry store is the
  intended end state, but the migration cost does not compound, so it is deliberately deferred
  behind the hardening work. Reasoning in [`hosting.md`](./hosting.md#storage-architecture).

## Picking up the work

1. Read [`code-review/README.md`](./code-review/README.md) for the findings index, the priority
   ordering, and the sequencing constraints between items.
2. Pick a finding. Each one is written to be actionable standalone — you should not need to
   re-explore the codebase to start.
3. Verify the `file:line` references before acting on them. They were accurate at `631b649` and
   drift as the code changes.
4. Check the box, and note anything you found that the review got wrong.
