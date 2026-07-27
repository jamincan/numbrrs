# Hardening review — findings index

**Reviewed:** 2026-07-27 · **Commit:** `631b649` · **Scope:** whole codebase (~4,000 lines)

## State of the codebase

The app is in good shape. This is a hardening exercise, not a rescue.

Worth stating plainly, because a list of 26 findings reads worse than the code actually is:
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

## P1 — before growth

| ID                                               | Finding                                                             | Effort |     |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------ | --- |
| [ERR-1](./02-error-handling.md#err-1)            | No `+error.svelte` anywhere — 404s render unstyled and English      | S      | ☐   |
| [ERR-2](./02-error-handling.md#err-2)            | No `handleError` hook — unexpected errors are untraceable           | S      | ☐   |
| [ERR-3](./02-error-handling.md#err-3)            | Unguarded `localStorage` breaks the game in Safari private browsing | S      | ☐   |
| [ABUSE-1](./05-abuse-resistance.md#abuse-1)      | `/api/sync` has no rate limit and logs nothing on failed auth       | S      | ☐   |
| [PERF-1](./07-caching-and-scaling.md#perf-1)     | No page-level `Cache-Control` — every request re-renders            | S      | ☐   |
| [MAINT-3](./09-maintainability.md#maint-3)       | `README.md` is stale and omits `SYNC_TOKEN`                         | S      | ☐   |
| [LIC-3](./01-licensing-and-attribution.md#lic-3) | No non-affiliation disclaimer or data-source attribution            | S      | ☐   |
| [LIC-1](./01-licensing-and-attribution.md#lic-1) | Club logos and marks redistributed under MIT                        | M      | ☐   |
| [VAL-1](./03-external-api-validation.md#val-1)   | League API responses are `as`-cast with no runtime validation       | M      | ☐   |
| [ABUSE-2](./05-abuse-resistance.md#abuse-2)      | A failing league API is re-fetched on every home-page load          | M      | ☐   |
| [TEST-1](./08-testing.md#test-1)                 | The only code that deletes rows has zero tests                      | L      | ☐   |

## P2 — soon

| ID                                               | Finding                                                             | Effort |     |
| ------------------------------------------------ | ------------------------------------------------------------------- | ------ | --- |
| [ERR-4](./02-error-handling.md#err-4)            | `migrate()` at module import turns a bad migration into opaque 500s | S      | ☐   |
| [TYPE-1](./04-type-safety.md#type-1)             | `db` is typed as always-defined but is `undefined` during build     | S      | ☐   |
| [SEC-1](./06-security-hardening.md#sec-1)        | `style-src` concession is broader than it needs to be               | S      | ☐   |
| [PERF-2](./07-caching-and-scaling.md#perf-2)     | The app cannot scale past one machine — undocumented                | S      | ☐   |
| [PERF-3](./07-caching-and-scaling.md#perf-3)     | No health check endpoint                                            | S      | ☐   |
| [LIC-2](./01-licensing-and-attribution.md#lic-2) | OFL font licence does not ship with the self-hosted fonts           | S      | ☐   |
| [TYPE-2](./04-type-safety.md#type-2)             | `noUncheckedIndexedAccess` is off, hiding a module-load crash       | M      | ☐   |
| [MAINT-2](./09-maintainability.md#maint-2)       | Some comments narrate history rather than explain the code          | M      | ☐   |
| [TEST-2](./08-testing.md#test-2)                 | No end-to-end tests                                                 | L      | ☐   |
| [MAINT-1](./09-maintainability.md#maint-1)       | `RosterGame.svelte` is 638 lines with three separable concerns      | L      | ☐   |

## P3 — correctness and polish

| ID                                          | Finding                                               | Effort |     |
| ------------------------------------------- | ----------------------------------------------------- | ------ | --- |
| [TYPE-3](./04-type-safety.md#type-3)        | `Accept-Language: fr;q=0` resolves to French          | S      | ☐   |
| [ABUSE-3](./05-abuse-resistance.md#abuse-3) | `SYNC_TOKEN` has no minimum length                    | S      | ☐   |
| [SEC-2](./06-security-hardening.md#sec-2)   | No `Cross-Origin-Opener-Policy`                       | S      | ☐   |
| [SEC-3](./06-security-hardening.md#sec-3)   | Cookie values are written unencoded                   | S      | ☐   |
| [SEC-4](./06-security-hardening.md#sec-4)   | Redirect param interpolated into `Location` unencoded | S      | ☐   |
| [TEST-3](./08-testing.md#test-3)            | CI has no dependency audit                            | S      | ☐   |
| [MAINT-4](./09-maintainability.md#maint-4)  | Duplicated markup, repeated literals, template cruft  | S      | ☐   |

## Sequencing

Most findings are independent. Three pairs are not, and doing them out of order means redoing
work:

1. **TYPE-1 before TEST-1.** The sync-layer tests need to point the module at an in-memory
   database; that requires the `db` export to be injectable, which is TYPE-1.
2. **TYPE-2 before MAINT-1.** Turning on `noUncheckedIndexedAccess` produces type errors inside
   `RosterGame.svelte`. Fix them while it is still one file rather than five.
3. **VAL-1 before ABUSE-2.** A schema parse failure should feed the same backoff path as a
   network failure. Build the classification first, then the backoff that consumes it.

Beyond that, the P1 items are a sensible first pass in table order — six of them are S-effort and
independent.

## Re-review when the admin dashboard lands

> [!WARNING]
> This review predates the structured logging and admin dashboard work. Several conclusions were
> scoped to an app with no user accounts and one fire-and-forget API token. Revisit these before
> relying on them:

- **The auth-library question reopens.** [SEC](./06-security-hardening.md) concludes that adding
  Auth.js or Lucia would be overhead — that judgement rests on there being no sessions, no login
  form, and no user accounts. An admin dashboard has all three. A hand-rolled session layer is a
  substantially harder thing to get right than a single bearer-token comparison, and the
  calculus that made a library overkill no longer holds.
- **Rate limiting should cover the admin login first.** [ABUSE-1](./05-abuse-resistance.md#abuse-1)
  scopes rate limiting to `/api/sync`. A login endpoint is the more attractive target and needs
  it more.
- **Error handling should route through the logger.** [ERR-2](./02-error-handling.md#err-2)
  proposes a `handleError` hook using `console.error`. If structured logging now exists, use it —
  and make sure the hook does not log secrets or request bodies.
- **Audit what the logs capture.** Log storage is a new place for PII, tokens, session IDs, and
  IP addresses to accumulate. Check retention, and check that the admin dashboard does not render
  logged values as HTML without escaping.
- **The CSP tightening in [SEC-1](./06-security-hardening.md#sec-1) may not survive.** Dashboards
  tend to bring charting or component libraries that inject inline styles. Verify against the
  built output before assuming `style-src 'self'` still holds.
- **`ALERT_WEBHOOK_URL` is an SSRF surface** if the destination is ever configurable at runtime
  rather than fixed at deploy time. Also check what the alert payloads contain — they leave your
  infrastructure.
