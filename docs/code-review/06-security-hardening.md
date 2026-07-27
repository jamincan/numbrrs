# Security hardening

## First, what is not wrong

Stated up front so nobody spends an afternoon looking for a problem that isn't there.

**The authentication is correct.** `api/sync/+server.ts:12-16`:

```ts
function tokenMatches(provided: string, expected: string): boolean {
	const a = Buffer.from(provided);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}
```

This is the right implementation. It uses `timingSafeEqual`, it handles the length-mismatch case
that would otherwise make `timingSafeEqual` throw, and the comment at `:7-11` correctly reasons
that leaking the token's length is not worth defending against. It compares the entire
`Authorization` header value against `Bearer ${token}` rather than parsing the header first,
which sidesteps a whole class of parser-mismatch bugs. There is nothing to fix here.

**An auth library would be overhead — today.** There are no user accounts, no sessions, no
password storage, and no user-supplied data persisted anywhere. Adding Auth.js or Lucia would
introduce a dependency, a session store, and a migration surface in exchange for nothing. The
one-token model is proportionate.

> [!WARNING]
> That conclusion is scoped to the reviewed commit. The unpushed admin dashboard introduces
> sessions and a login form, and a hand-rolled session layer is a substantially harder thing to
> get right than a single bearer-token comparison. Re-evaluate then — see
> [the re-review checklist](./README.md#re-review-when-the-admin-dashboard-lands).

**Other things already done right:** SQL is fully parameterised through Drizzle with no raw
string interpolation anywhere; `hooks.server.ts:49-54` already sets `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy` and HSTS; `frame-ancestors: 'none'` covers clickjacking
without needing `X-Frame-Options`; server-only code is properly isolated behind `$lib/server`,
and `types.ts:1-7` explains the deliberate type duplication that keeps the native SQLite binding
away from the client bundle.

The remaining items are genuine but small.

---

<a id="sec-1"></a>

## SEC-1 — `style-src` concession is broader than it needs to be

**Priority:** P2 · **Effort:** S

### What

`svelte.config.js:11-23` sets a real, well-considered CSP. One directive is looser than
necessary:

```js
'style-src': ['self', 'unsafe-inline'],
```

The comment at `:7-10` explains why: team-colour theming uses inline `style` attributes
throughout (`+page.svelte:98-99`, `HockeyCard.svelte:49`, `RosterGame.svelte:362-363`, and
others). That is accurate — those attributes genuinely need the concession.

But inline `style` **attributes** are governed by `style-src-attr`, and inline `<style>`
**elements** by `style-src-elem`; each falls back to `style-src` only when unset. Setting them
separately keeps `unsafe-inline` where it is actually required and denies injected `<style>`
blocks:

```js
'style-src': ['self'],
'style-src-attr': ['unsafe-inline'],
```

SvelteKit's `csp.directives` supports both.

### Test this before shipping

`style-src-attr` is CSP Level 3. A browser that does not support it ignores the directive and
falls back to `style-src: 'self'` — which would block every inline style attribute and strip all
team colouring from the site. Support is broad as of 2026 (Chrome 75+, Safari 15.4+, Firefox
123+), but this is a change that fails _visually and silently_ on older clients rather than
throwing. Verify against the built output and an older browser before deploying.

### While you are in this file

`'img-src': ['self', 'https:', 'data:']` allows images from any HTTPS origin. The comment
explains it covers league CDNs, which is true — headshots come from `assets.nhle.com` and logos
from HockeyTech. Narrowing to those specific hosts would be tighter, at the cost of a code change
whenever a league moves its CDN. A reasonable trade either way; worth a deliberate decision
rather than leaving it as a default.

---

<a id="sec-2"></a>

## SEC-2 — No `Cross-Origin-Opener-Policy`

**Priority:** P3 · **Effort:** S

### What

`hooks.server.ts:49-54` sets four security headers but not COOP, which severs the
`window.opener` relationship with cross-origin openers.

Low impact here — the only outbound link is the GitHub one at `+layout.svelte:71-75`, which
already correctly carries `rel="noopener noreferrer"`. COOP is defence in depth for links added
later that forget it.

### Action

Add `response.headers.set('Cross-Origin-Opener-Policy', 'same-origin')` alongside the existing
headers.

---

<a id="sec-3"></a>

## SEC-3 — Cookie values are written unencoded

**Priority:** P3 · **Effort:** S

### What

`src/lib/cookies.ts:6-9`:

```ts
export function rememberCookie(name: string, value: string, maxAge: number) {
	const secure = location.protocol === 'https:' ? '; secure' : '';
	document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secure}`;
}
```

`value` is interpolated straight into the cookie string. **Not exploitable today** — there are
exactly two call sites and both pass values from closed sets: locale IDs (`state.svelte.ts:49`)
and league IDs (`+page.svelte:26`). The cookie attributes themselves are all correct: `Lax`,
path-scoped, and conditionally `Secure` with a good explanation for the condition.

The issue is that the signature accepts any `string`, so the safety lives in the callers rather
than in the function.

### Action

Either `encodeURIComponent(value)`, or narrow the parameter type so only the known-safe unions
can be passed. The type-level fix is the better one — it makes the guarantee visible.

---

<a id="sec-4"></a>

## SEC-4 — Redirect param interpolated into `Location` unencoded

**Priority:** P3 · **Effort:** S

### What

`src/routes/[[lang=locale]]/game/[team]/+page.server.ts:5-8`:

```ts
export function load({ params }) {
	const prefix = params.lang ? `/${params.lang}` : '';
	redirect(301, `${prefix}/game/nhl/${params.team.toUpperCase()}`);
}
```

`params.team` is attacker-controlled and goes into a `Location` header.

**This is not an open redirect.** A route segment cannot contain `/`, so the target always stays
on-origin, and `params.lang` is constrained to `'fr'` by the matcher at `src/params/locale.ts:8`.
A URL-encoded `%0D%0A` would decode into the param, but Node rejects CR/LF in header values — so
the outcome is a 500, not a header injection.

It is the correct shape rather than a live vulnerability: user input reaching a response header
without encoding is a pattern worth not having in the codebase, and the fix costs nothing.

### Action

`encodeURIComponent(params.team.toUpperCase())`.

Keep the route itself — the comment at `:3-4` explains it preserves pre-PWHL bookmarks
(`/game/TOR`), which is worth maintaining.
