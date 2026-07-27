# Abuse resistance

How the app behaves under traffic it did not ask for — a crawler, a spike, or an upstream outage
coinciding with either.

---

<a id="abuse-2"></a>

## ABUSE-2 — A failing league API is re-fetched on every page load

**Priority:** P1 · **Effort:** M

### What

Sync freshness is recorded **only on success**. `markSynced()` (`server/leagues/index.ts:65-71`)
is called at exactly two places: `syncTeamList:123` and, as a `teams.rosterSyncedAt` update,
`syncRoster:185`. Both are reached only after the upstream fetch succeeded — `syncTeamList`
returns early at `:84` (fetch threw) and `:89` (empty response) without recording anything.

So there is no negative caching. A league that is down is treated identically to a league that
has never been synced, on every request, indefinitely.

### What actually happens

The `once()` coalescing at `:50-59` bounds this more than it first appears — only one sync per
key can be in flight — so the failure mode is not unbounded fan-out. It is worse in a quieter
way:

**Continuous retry with no backoff.** While traffic continues, a failing league is re-attempted
as fast as the previous attempt completes. With `FETCH_TIMEOUT` at 10s (`http.ts:7`), that is
roughly six attempts per minute per failing league, forever, with no escalation and no
circuit-breaking.

**Cold-start requests block for 8 seconds each.** `ensureTeams:228` only adds a league to the
blocking set when `!known.has(adapter.id)` — i.e. the database has no teams for it. After a
fresh deploy against an empty volume, with an upstream that is failing, _every_ home-page request
waits the full `BLOCKING_TIMEOUT` of 8s (`:27`, `:231-235`) before rendering "teams syncing". On a
256MB shared-CPU Fly VM, requests each occupying 8 seconds is a resource problem before it is a
UX problem.

**Team pages are the more exposed path.** `loadRoster:283-288` re-syncs whenever
`rosterSyncedAt` is stale, blocking up to 8s. Because failures are never recorded, a team whose
roster cannot be fetched blocks on _every single visit_.

Now note that `sitemap.xml/+server.ts:13-14` publishes every team in the database across both
locales, and `static/robots.txt` invites crawling. A crawler walking the sitemap during an
upstream outage visits every team page, each one triggering its own blocking upstream fetch. That
is the realistic worst case, and it needs no malice at all.

### Action

Record failures and back off.

- Add failure tracking to the `sync_state` table (`db/schema.ts:24-27`) — a `failed_at` and
  `failure_count` column, with a Drizzle migration. The table already exists for exactly this
  kind of non-team-scoped freshness bookkeeping and its doc comment at `:19-23` describes the
  intent.
- Skip re-attempts until an exponential backoff expires (e.g. 1min → 2 → 4 → capped at 30min).
- Clear the failure state on the next success.
- Apply to both the team-list path (`ensureTeams`, `ensureTeam`) and the roster path
  (`loadRoster`).

Do this **after** [VAL-1](./03-external-api-validation.md#val-1), so a schema-break failure feeds
the same backoff as a network failure rather than needing a second mechanism later.

### Leave alone

The guard at `:251-260` — the one that stops a bogus team code from triggering an upstream
fetch — is correct and its comment explains the reasoning well. It solves a different problem
(unknown code, _fresh_ team list) and should stay as-is.

---

<a id="abuse-1"></a>

## ABUSE-1 — `/api/sync` has no rate limit and logs nothing on failed auth

**Priority:** P1 · **Effort:** S

### What

`src/routes/api/sync/+server.ts` is the only authenticated endpoint. The token comparison itself
is correct — see [SEC](./06-security-hardening.md) — but around it:

- **No rate limiting.** An attacker gets unlimited token guesses at whatever rate the network
  allows.
- **No logging on failure.** `:36-38` returns 401 silently. There is no record that anyone ever
  tried, so a sustained attack is invisible.
- The endpoint triggers a full sync of every team in every league (`:40`), which the comment at
  `:52-55` notes takes a couple of minutes. That is an expensive thing to sit behind an
  unmonitored door.

### Action

Add a small fixed-window in-memory rate limiter, applied in `hooks.server.ts` to `/api/*`, and
`console.warn` (or the structured logger, if it now exists) on every 401 with the source IP.

In-memory is the correct choice given the deployment is a single machine — but note in a comment
that it becomes per-instance if the app is ever scaled, since
[PERF-2](./07-caching-and-scaling.md#perf-2) documents that same single-process assumption
elsewhere.

Consider extending a looser limit to page routes too, given the upstream work a team-page request
can trigger (see [ABUSE-2](#abuse-2)).

> [!NOTE]
> When the admin dashboard lands, its login endpoint needs this more than `/api/sync` does. A
> login form is a far more attractive target than an undocumented bearer endpoint.

---

<a id="abuse-3"></a>

## ABUSE-3 — `SYNC_TOKEN` has no minimum length

**Priority:** P3 · **Effort:** S

### What

`api/sync/+server.ts:30-33` only checks that the token is non-empty:

```ts
const token = env.SYNC_TOKEN;
if (!token) {
	throw error(503, 'Sync endpoint is not configured (SYNC_TOKEN unset)');
}
```

`SYNC_TOKEN=a` is accepted and defeats the constant-time comparison entirely. `.env.example:7`
gives no guidance on what a reasonable value looks like.

### Action

Validate at startup rather than per-request — a minimum length (32 chars) checked once, failing
loudly at boot. Document the expectation in `.env.example` and `README.md`, with a generation
command (`openssl rand -hex 32`).
