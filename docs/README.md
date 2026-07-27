# NumBrrs documentation

## What's here

- [`code-review/`](./code-review/) — a hardening review of the codebase, published as a
  trackable backlog. Findings are prioritised, carry `file:line` evidence, and have status
  boxes so work can be picked up and checked off across sessions.

## Scope and staleness

The review was performed on **2026-07-27** against commit
[`631b649`](https://github.com/jamincan/numbrrs/commit/631b649) ("Serve the roster from one
drawer at every size").

It is a **point-in-time review, not permanent architecture documentation**. It describes the
codebase as it stood on that date. Once the findings are worked through, this directory should
either be deleted or replaced with docs that describe the app rather than a moment in its
history — the failure mode for documents like these is quietly rotting into a description of a
codebase that no longer exists.

> [!IMPORTANT]
> This review **does not cover** the structured logging and admin dashboard work that was in
> progress locally and unpushed at the time. That work adds a significant new security surface —
> sessions, an authenticated UI, log storage, and outbound alerting — none of which existed in
> the reviewed code. Several conclusions here were scoped to a smaller app and need revisiting
> once it lands. See
> [Re-review when the admin dashboard lands](./code-review/README.md#re-review-when-the-admin-dashboard-lands).

## Picking up the work

1. Read [`code-review/README.md`](./code-review/README.md) for the findings index, the priority
   ordering, and the sequencing constraints between items.
2. Pick a finding. Each one is written to be actionable standalone — you should not need to
   re-explore the codebase to start.
3. Verify the `file:line` references before acting on them. They were accurate at `631b649` and
   drift as the code changes.
4. Check the box, and note anything you found that the review got wrong.
