# Privacy and telemetry

Added 2026-07-27, after the telemetry and admin dashboard work landed in `586b5e4` / `ff92fdf`.
The original review predates all of this code and says nothing about it.

## First, what is not wrong

The analytics were built with this problem in mind, and the design is the conservative one.

**The visitor hash is genuinely privacy-preserving.** `analytics.ts:17-24` generates a 32-byte
salt with `randomBytes`, rotates it when the calendar day changes, and **never writes it to
disk**. `telemetry.ts:53-59` hashes `salt + day + ip + userAgent` and keeps 16 hex characters.
Because the salt does not survive the day — or a machine restart — the same visitor on two days
produces unrelated hashes and there is no key anywhere that could re-link them. That is the
Plausible/Fathom model, and the schema comment at `db/schema.ts:53-56` states the property as a
deliberate one: cross-day retention is unanswerable _by construction, not by omission_.

**Only the referrer host is stored,** never the full URL (`telemetry.ts:61-65`), so the table
records "traffic came from Discord" without recording which Discord message.

**The errors table cannot be flooded.** It is keyed by fingerprint with a `count`, so a route
throwing 100,000 times adds one row (`db/schema.ts:88-92`). This is the table that would
otherwise be dangerous during a spike, and it structurally cannot be.

**`/api/client-error` is well defended.** It carries a per-IP limit (5 per 10 minutes), a global
limit (100/hour), an 8 KB body cap, JSON parsing behind a `try`, type guards on every field, and
route truncation — plus bounded growth on the rate-limit map itself. There is no missing input
validation here.

**Pruning already exists.** `analytics.ts:47-62` deletes from both tables on a 90-day cutoff,
riding along on a request rather than a timer, with a comment explaining why a timer would be
wrong on a machine that stops when idle.

**Nothing is rendered unescaped.** There is no `{@html}` anywhere in `src/`, so every logged
value the dashboard displays goes through Svelte's auto-escaping.

The two findings below are what is left.

---

<a id="priv-1"></a>

## PRIV-1 — No privacy policy or data-handling disclosure

**Priority:** P1 · **Effort:** S

### What

The app collects analytics on every page view and stores error reports, and nothing tells a
visitor so. There is no `/privacy` route, no `/about`, and no legal page of any kind —
`find src/routes -type d` turns up nothing.

This matters more than it would for a site with no analytics at all, and it matters in a
direction that is easy to get backwards: **the current implementation is the GDPR-easy option,
and there is nothing written down that says so.** Salted-and-rotated hashing with no cookies, no
third-party processor, and 90-day retention is precisely the basis on which cookieless analytics
tools claim they need no consent banner. The work is done; the disclosure is not.

Jurisdiction, briefly and without pretending this is legal advice: the app is hosted in Canada
(`yyz`) so PIPEDA applies domestically, and GDPR reaches services that monitor the behaviour of
people in the EU — which a public hockey site posted to a large subreddit will do. The salted-hash
design means very little personal data is involved either way, which is the point of having built
it that way.

### Action

Add a short `/privacy` page — a `[[lang=locale]]` route so it exists in both languages — stating:

- What is recorded per page view: path, route, league, team, locale, referrer host, and a
  salted daily hash.
- That the salt is random per day and never stored, so visits cannot be linked across days.
- That no cookies are used for analytics. (The `numbrrs_locale` and `numbrrs_league` cookies are
  preference cookies, not tracking — worth saying explicitly.)
- That errors are recorded to diagnose faults and may include a stack trace.
- The 90-day retention window.
- That nothing is sold, and that data leaves the infrastructure only as error alerts to a private
  Discord channel.
- Contact for a deletion or access request.

Link it from the footer. Do this **together with [LIC-3](./01-licensing-and-attribution.md#lic-3)**
— that finding wants a footer for the non-affiliation disclaimer, and this wants the same footer.
One piece of markup, two findings.

> [!NOTE]
> If telemetry is ever moved to a hosted provider, this gets **harder**, not easier: a US
> processor adds a DPA, a transfer mechanism, and a processing record, and most error trackers
> capture IP addresses by default unless explicitly configured not to. See
> [`../hosting.md`](../hosting.md) for why that trade was considered and declined.

---

<a id="priv-2"></a>

## PRIV-2 — Client-submitted error text reaches Discord unescaped

**Priority:** P2 · **Effort:** S

### What

`alerts.ts:104-122` builds the Discord payload by interpolating the error into a Markdown code
fence:

````ts
const lines = [
	`**numbrrs ${report.source} error**${count > 1 ? ` (${count}× so far)` : ''}`,
	route ? `\`${route}\`` : null,
	'```',
	truncate(report.stack || message, 1200),
	'```',
	`${SITE_ORIGIN}/admin`
];
````

For `source: 'server'` that content is entirely internal. For `source: 'client'` it is not:
`message`, `stack`, and `route` all come from a `POST` body that anyone can send
(`api/client-error/+server.ts:64-73`). A report containing a triple backtick closes the fence
early, after which the rest of the payload is interpreted as Markdown rather than displayed as
text — and the `route` value sits inside single backticks with the same problem.

The webhook body sets no `allowed_mentions`, so depending on the channel's permissions a payload
containing `@everyone` or `@here` can ping the server.

### Why it is small but worth fixing

The blast radius is tightly bounded already, which is why this is P2 rather than P1: the endpoint
allows 5 reports per IP per 10 minutes and 100/hour globally, `NOTIFY_COOLDOWN_MS` suppresses
repeats of the same fingerprint for an hour, and `NOTIFY_BURST_LIMIT` caps notifications at 5 per
hour across all fingerprints (`alerts.ts:20-31`). Someone who found the endpoint could put
arbitrary text — and possibly a mention — into the alert channel at most five times an hour.

That is a nuisance rather than a breach. But the fix is one JSON field plus one escape, the alert
channel is the thing you will be watching _during_ a traffic spike, and an alert channel you have
learned to distrust is worse than no alert channel.

### Action

1. Add `allowed_mentions: { parse: [] }` to the webhook body. This is the documented way to stop
   a webhook message from pinging anything, and it is a strict improvement regardless of the
   escaping.
2. Neutralize backticks in interpolated values before building the message — replacing
   `` ` `` with a lookalike, or stripping them, is enough. Apply to `route` as well as the body.
3. Consider marking client-sourced alerts visually (the payload already carries `report.source`),
   so a reader can tell at a glance whether the content is trusted.

### Leave alone

The ordering in `reportError` — durable write first, fire-and-forget webhook second — is
deliberate and correct, and the comment at `alerts.ts:38-46` explains why: a detached fetch can
be cut off when Fly stops the machine, so the row must not be the thing racing the shutdown.
Do not make the webhook `await`ed while "fixing" this.

---

## Done 2026-07-27 — PRIV-1

`/privacy` exists under `[[lang=locale]]`, so it is a real page in both languages and appears in
the sitemap twice. It states what a page view records, explains the daily-rotated salt in plain
language (the point being that nothing can link a code back to a person once the day is over, and
that the IP itself is never stored), separates the two preference cookies from tracking, covers
error records and the 90-day window, says the data stays on the Canadian server it was collected
on, and points questions at the repository's issues.

Linked from the footer added for [LIC-3](./01-licensing-and-attribution.md#lic-3) — one piece of
markup, both findings, as this document suggested.

The "last updated" date is a hardcoded constant rather than a build timestamp. A policy that
claims to have changed on every deploy tells a reader nothing; **change it by hand when the
wording changes**, and only then.

### Check this when the retention numbers move

The page commits to specifics that live in code: 90 days, and "older records are also removed
once the store passes a fixed size" — which is `RETENTION_MS` and `MAX_EVENTS` in `analytics.ts`
(see [ABUSE-4](./05-abuse-resistance.md#abuse-4)). If either constant changes, this page is now
wrong in a way that matters more than a stale comment would.
