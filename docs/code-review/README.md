# Hardening review — findings index

**Reviewed:** 2026-07-27 · **Commit:** `631b649` · **Scope:** whole codebase (~4,000 lines)
**Status pass:** 2026-07-27 against `ff92fdf`, after the telemetry and admin dashboard work landed.

## State of the codebase

The app is in good shape. This is a hardening exercise, not a rescue.

Worth stating plainly, because a list of 29 findings reads worse than the code actually is:
the codebase is consistently typed, the sync layer coalesces concurrent work correctly and
degrades to stale data rather than failing, the CSP is real and thought-through, comments
explain non-obvious constraints instead of restating the code, and the one piece of
authentication present uses `timingSafeEqual` correctly — which is the thing people usually get
wrong, and it isn't wrong here.

What drove the review was an expected growth in users. Under that lens the gaps that matter are
not the ones a static read flags first. They are: no error page at all, no runtime validation of
external API responses, no negative caching when a league API is down (so traffic multiplies
pressure on an already-struggling upstream), no page cache headers, and third-party trademarks
redistributed under a licence that cannot cover them.

## Reading the table

- **Priority** — P1: do before a traffic increase. P2: do soon. P3: correctness and polish.
- **Effort** — S: under an hour. M: half a day. L: a day or more.
- **Status** — ☐ open · ◑ partially done · ☑ done.

## P1 — before growth

| ID                                               | Finding                                                              | Effort |     |
| ------------------------------------------------ | -------------------------------------------------------------------- | ------ | --- |
| [ERR-1](./02-error-handling.md#err-1)            | No `+error.svelte` anywhere — 404s render unstyled and English       | S      | ☑   |
| [ERR-2](./02-error-handling.md#err-2)            | No `handleError` hook — unexpected errors are untraceable            | S      | ☑   |
| [ERR-3](./02-error-handling.md#err-3)            | Unguarded `localStorage` breaks the game in Safari private browsing  | S      | ☑   |
| [SEC-5](./06-security-hardening.md#sec-5)        | Remove `/api/sync` and `SYNC_TOKEN` — a second secret buying nothing | S      | ☑   |
| [ABUSE-1](./05-abuse-resistance.md#abuse-1)      | No rate limit on the `/admin` login; failed auth unlogged            | S      | ☑   |
| [ABUSE-4](./05-abuse-resistance.md#abuse-4)      | `events` retention is time-only — a spike writes ~125 MB in a day    | S      | ☑   |
| [PERF-1](./07-caching-and-scaling.md#perf-1)     | No page-level `Cache-Control` — every request re-renders             | S      | ☑   |
| [PRIV-1](./10-privacy-and-telemetry.md#priv-1)   | No privacy policy or data-handling disclosure                        | S      | ☑   |
| [MAINT-3](./09-maintainability.md#maint-3)       | `README.md` is stale — five leagues, not two                         | S      | ☑   |
| [LIC-3](./01-licensing-and-attribution.md#lic-3) | No non-affiliation disclaimer or data-source attribution             | S      | ☑   |
| [LIC-1](./01-licensing-and-attribution.md#lic-1) | Club logos and marks redistributed under MIT                         | M      | ☑   |
| [VAL-1](./03-external-api-validation.md#val-1)   | League API responses are `as`-cast with no runtime validation        | M      | ☑   |
| [ABUSE-2](./05-abuse-resistance.md#abuse-2)      | A failing league API is re-fetched on every home-page load           | M      | ☑   |
| [TEST-1](./08-testing.md#test-1)                 | The only code that deletes rows has zero tests                       | L      | ☑   |

## P2 — soon

| ID                                               | Finding                                                             | Effort |     |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------ | --- |
| [ERR-4](./02-error-handling.md#err-4)            | `migrate()` at module import turns a bad migration into opaque 500s | S      | ☑   |
| [TYPE-1](./04-type-safety.md#type-1)             | `db` is typed as always-defined but is `undefined` during build     | S      | ☑   |
| [SEC-1](./06-security-hardening.md#sec-1)        | `style-src` concession is broader than it needs to be               | S      | ☑   |
| [PERF-2](./07-caching-and-scaling.md#perf-2)     | The app cannot scale past one machine — undocumented                | S      | ☑   |
| [PERF-3](./07-caching-and-scaling.md#perf-3)     | No health check endpoint                                            | S      | ☑   |
| [PRIV-2](./10-privacy-and-telemetry.md#priv-2)   | Client-submitted error text reaches Discord unescaped               | S      | ☑   |
| [LIC-2](./01-licensing-and-attribution.md#lic-2) | OFL font licence does not ship with the self-hosted fonts           | S      | ☑   |
| [TYPE-2](./04-type-safety.md#type-2)             | `noUncheckedIndexedAccess` is off, hiding a module-load crash       | M      | ☑   |
| [MAINT-2](./09-maintainability.md#maint-2)       | Some comments narrate history rather than explain the code          | M      | ☑   |
| [TEST-2](./08-testing.md#test-2)                 | No end-to-end tests                                                 | L      | ☐   |
| [MAINT-1](./09-maintainability.md#maint-1)       | `RosterGame.svelte` is 638 lines with three separable concerns      | L      | ☐   |

## P3 — correctness and polish

| ID                                         | Finding                                               | Effort |     |
| ------------------------------------------ | ----------------------------------------------------- | ------ | --- |
| [TYPE-3](./04-type-safety.md#type-3)       | `Accept-Language: fr;q=0` resolves to French          | S      | ☐   |
| [SEC-2](./06-security-hardening.md#sec-2)  | No `Cross-Origin-Opener-Policy`                       | S      | ☐   |
| [SEC-3](./06-security-hardening.md#sec-3)  | Cookie values are written unencoded                   | S      | ☐   |
| [SEC-4](./06-security-hardening.md#sec-4)  | Redirect param interpolated into `Location` unencoded | S      | ☐   |
| [TEST-3](./08-testing.md#test-3)           | CI has no dependency audit                            | S      | ☐   |
| [MAINT-4](./09-maintainability.md#maint-4) | Duplicated markup, repeated literals, template cruft  | S      | ☐   |

## Sequencing

Most findings are independent. Four pairs are not, and doing them out of order means redoing
work:

1. **TYPE-1 before TEST-1.** The sync-layer tests need to point the module at an in-memory
   database; that requires the `db` export to be injectable, which is TYPE-1.
2. **TYPE-2 before MAINT-1.** Turning on `noUncheckedIndexedAccess` produces type errors inside
   `RosterGame.svelte`. Fix them while it is still one file rather than five.
3. **VAL-1 before ABUSE-2.** A schema parse failure should feed the same backoff path as a
   network failure. Build the classification first, then the backoff that consumes it.
4. ~~**SEC-5 before ABUSE-1.**~~ Both done. Recorded because the order mattered: rate-limiting
   `/api/sync` first would have meant writing a limiter for an endpoint about to be deleted.

TYPE-1 has also picked up a second dependant: the retention bound added by ABUSE-4 cannot be
unit-tested until the `db` export is injectable, so **TYPE-1 now unblocks both TEST-1 and the
ABUSE-4 tests**. That raises its value above its P2 slot.

Three more pairings are convenience rather than constraint: **ERR-1 with ERR-2** (the error page
is where the error ID gets surfaced), **LIC-3 with PRIV-1** (both want the same footer), and
**MAINT-3 after SEC-5** (the README's secrets table changes shape when `SYNC_TOKEN` goes).

Beyond that, the P1 items are a sensible first pass in table order — nine of them are S-effort
and independent.

## Superseded

- **ABUSE-3** (`SYNC_TOKEN` has no minimum length) — the secret is being removed by
  [SEC-5](./06-security-hardening.md#sec-5). Do not implement it; its generation guidance moves
  to `ADMIN_TOKEN` via [MAINT-3](./09-maintainability.md#maint-3).

## Re-review: resolved 2026-07-27

The dashboard has landed (`586b5e4`, `ff92fdf`). Each item the original review flagged for
re-examination, and what the code actually turned out to do:

- **The auth-library question — closed, staying hand-rolled.** The review warned that a
  hand-rolled session layer is harder to get right than a bearer token and suggested revisiting
  Auth.js or Lucia. On inspection the landscape does not offer what that warning assumed:
  **Lucia is no longer a library** (it is now a guide to implementing sessions yourself), **Oslo
  is a primitives package**, not a session framework, and most of what it provides exists to
  serve runtimes that lack Node's crypto — on Node it would wrap the stdlib rather than replace
  it. `better-auth` and Auth.js both model user accounts, which this app does not have.

  `src/lib/server/admin.ts` was reviewed directly and is sound: HMAC over the expiry only (the
  token never enters the cookie), `httpOnly`, `sameSite: 'strict'`, path-scoped to `/admin`,
  `timingSafeEqual` on the signature, expiry checked before the signature, and a parse that
  tolerates malformed input. Rotating `ADMIN_TOKEN` invalidates every session.

  **Decision: keep it.** The assurance a library would provide is already provided by
  `node:crypto`; what is bespoke is roughly forty lines of glue that no user-account library
  would take over. Fronting `/admin` with Cloudflare Access was considered and declined — the
  session code is judged adequate on its own. The two things that _do_ raise confidence here are
  [ABUSE-1](./05-abuse-resistance.md#abuse-1) (rate-limit the login) and extending
  `admin.test.ts` to cover tampered signatures, tampered expiries, expired sessions, and
  malformed cookies. Do both.

- **Rate limiting should cover the admin login first — confirmed, and cheaper than expected.**
  Folded into [ABUSE-1](./05-abuse-resistance.md#abuse-1), which now leads with `/admin`. Note
  that a working fixed-window limiter **already exists** in
  `src/routes/api/client-error/+server.ts:20-46` — per-IP and global, with map-growth bounding.
  ABUSE-1 is now "lift and generalize that", not "write one".

- **Error handling should route through the logger — done.** `hooks.server.ts:77` exports
  `handleError`, routes through `reportError`, skips 404s so crawler noise does not bury real
  errors, and returns only `{ message }` to the client. The remaining piece is the error ID for
  correlating a user report to a log entry — see [ERR-2](./02-error-handling.md#err-2).

- **Audit what the logs capture — done, and mostly good.** See
  [privacy and telemetry](./10-privacy-and-telemetry.md) for the full pass. In short: the visitor
  hash uses a daily-rotated salt that is never written to disk, stores 16 hex characters, and
  makes cross-day correlation impossible by construction. Only the referrer _host_ is kept, not
  the path. There is **no `{@html}` anywhere in `src/`**, so the dashboard auto-escapes everything
  it renders and the XSS concern does not apply. Two gaps found: [PRIV-1](./10-privacy-and-telemetry.md#priv-1)
  (nothing discloses any of this to visitors) and [ABUSE-4](./05-abuse-resistance.md#abuse-4)
  (retention is calibrated for a much smaller app).

- **The CSP tightening may not survive — it survives.** The dashboard at
  `src/routes/admin/+page.svelte` brought no charting or component library; it is hand-written
  markup. [SEC-1](./06-security-hardening.md#sec-1) still applies as written. Verify against the
  built output anyway.

- **`ALERT_WEBHOOK_URL` as an SSRF surface — not applicable.** The destination is read from
  `env` at call time (`alerts.ts:100`) and is fixed at deploy; nothing lets a request influence
  it. The other half of that item — what the alert payloads contain — turned out to matter, and
  is now [PRIV-2](./10-privacy-and-telemetry.md#priv-2).
