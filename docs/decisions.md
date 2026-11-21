# Decisions

Choices that were argued out and are not obvious from the code, each with its reason. They are not
meant to be reopened without new information; when one is, change the entry and its date rather
than adding a second one that contradicts it.

Most come from the July 2026 hardening review, which has been worked through and removed. Its
findings are not copied here: they are in git history under `docs/code-review/`, added in
`44eef6a` and last changed in `09bde2a` (`git show 09bde2a:docs/code-review/README.md`). The rest
come from the [November 2026 audit](./audit-2026-11.md).

## Admin and authentication

- **The `/admin` session layer is hand-rolled, and stays that way** (2026-07-27). No library fits:
  Lucia is now a guide rather than a package, Oslo is a set of primitives that on Node would wrap
  `node:crypto` rather than replace it, and Auth.js and better-auth model user accounts, which
  this app does not have. What is bespoke is about forty lines in `src/lib/server/admin.ts`; the
  confidence in it comes from the rate-limited login and from `admin.test.ts`, not from a
  dependency.

- **Cloudflare Access sits in front of `/admin` as a second layer, and the app checks it itself**
  (2026-11-21, `ea70ed3`; first considered and declined on 2026-07-27). The Access application
  alone is not enough, because a connection made straight to Fly that names `numbrrs.app` as its
  host never passes through Cloudflare. So the app validates the Access token on every `/admin`
  request and answers 403 without one. The session code beneath it is unchanged.

- **`ADMIN_DIRECT` is the way in when Cloudflare is down** (2026-11-21). With Access enforced by
  the app, a Cloudflare outage would otherwise lock the owner out of `/admin` at the moment it is
  most wanted. It is a switch on Fly rather than a second path that is always open, and a server
  started with it set says so loudly (an alert, a banner, a log line), because the cost of
  forgetting to unset it is `/admin` guarded by the token alone.

- **There is no HTTP endpoint for triggering a sync** (2026-07-27). `/api/sync` and its
  `SYNC_TOKEN` were removed: a second secret and a second public entry point for something
  `/admin` already does, on an endpoint that costs minutes of upstream requests per call. A manual
  resync is a form action behind the admin session; routine refreshing is the hourly sweep inside
  the app, which needs nothing external to call it.

## Storage and scaling

- **Storage is SQLite on one Fly volume, for now** (2026-07-27). The intended end state is rosters
  held in memory and telemetry in a managed serverless store (Turso or Neon), which would leave
  the app stateless. It is deferred because the cost of moving does not grow with time: storage
  already sits behind the sync layer's interface, and rosters are a few thousand rows of derived
  data whenever the move happens. Unmanaged Postgres on Fly is ruled out either way, since it only
  relocates the volume onto infrastructure Fly does not support. The reasoning is in
  [`hosting.md`](./hosting.md#storage-architecture).

- **One machine, scaled up and never out** (2026-07-27). The volume attaches to a single machine,
  and the sync coalescing and the rate limiter are per-process. `fly scale count` would give each
  new machine an empty database of its own. A traffic spike is the CDN's job, with a bigger
  machine as headroom.

- **The container runs as root on Fly** (2026-11-21). A Fly machine is a microVM with its own
  kernel, so the boundary a non-root user would add inside a shared-kernel container is already
  drawn around the whole machine, and the image holds nothing but the built server and its four
  runtime dependencies. Switching users would need a one-time `chown` of `/data` on the production
  volume before the first such deploy, and a mistake there is a server that cannot open its
  database.

## Analytics and privacy

- **Analytics are first-party only** (2026-07-27). Hosted analytics, a hosted error tracker and
  self-hosted alternatives were all considered and declined. Beyond the cost and the second
  vendor, a hosted processor makes the privacy position harder, not easier: it adds a data
  processing agreement and a transfer mechanism, and most error trackers record IP addresses
  unless told not to. This is also why Cloudflare's Web Analytics beacon must stay off for the
  zone.

- **The visitor hash uses a salt that rotates daily and is never saved** (2026-07-27). That is the
  whole basis for running without a consent banner: no cookie, no identifier at rest, and no key
  anywhere that could link one day's visits to the next. The price is that cross-day questions
  (returning visitors, retention) cannot be answered, and multi-day "visitor" figures are sums of
  daily counts. That is by design. Persisting the salt to answer them would be a privacy decision,
  not a bug fix.

## Feeds and sync

- **Logo and headshot hosts are not allowlisted, and `img-src` stays `https:`** (first raised
  2026-07-27, decided 2026-11-21). An allowlist would be tighter, but a league moving its images to
  another CDN would then blank every logo until someone noticed and deployed. Feed image addresses
  must instead be `https:` and of a sane length, and one that is not is left blank rather than
  costing the team or the player.

- **A team list that loses more than half its teams is refused; a roster that shrinks is not**
  (2026-11-21). A partial team list deletes real teams and their players, and no league loses half
  its clubs at once. A roster legitimately shrinks by more than half when training camp ends, so a
  guard there would fight real data; an empty roster is still refused.

- **`backoff.ts` and `validate.ts` stay separate from the sync layer** (2026-07-28). Each was
  checked against the question of whether it still earns its own file, and does. The backoff
  schedule is pure arithmetic that can be tested without a database, an adapter or a clock.
  `validate.ts` holds the one thing both adapters and the sync layer have to agree on: what counts
  as a feed that has changed (never retried) rather than a feed that is down (retried).

## Code and UI

- **`Accept-Language` is parsed by twenty lines of our own, not a library** (2026-07-28).
  `negotiator` or `@formatjs/intl-localematcher` would be the usual advice. The parser handles
  quality values and primary subtags, is covered by tests, and serves exactly two locales. A
  dependency would replace none of the thinking and add something to keep up to date.

- **Comments state a constraint, a rejected alternative or a consequence, and are not swept**
  (2026-07-28). Many comments here are the only record of why something subtle is the way it is,
  so a tidy-up pass through them would destroy more than it cleans. One that only makes sense to
  someone who saw the previous version of the code gets rewritten in the present tense; the rest
  are left alone.

- **How the cards look is the owner's call** (2026-11-21). The November audit measured contrast
  and text-size shortfalls on the cards, and every fix it proposed changes a look that was tuned by
  hand. They are recorded in the audit and deliberately not applied on anyone else's initiative:
  visual restyling is out of scope unless the owner asks for it.
