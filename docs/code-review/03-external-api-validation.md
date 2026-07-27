# External API validation

---

<a id="val-1"></a>

## VAL-1 — League API responses are `as`-cast with no runtime validation

**Priority:** P1 · **Effort:** M

### What

Every response from every external API is asserted into a TypeScript type rather than checked.
The declared types describe what the leagues returned when the adapters were written; nothing
verifies they still do.

The app consumes two external sources, neither of which it controls or has a support
relationship with:

- The NHL's undocumented `api-web.nhle.com` (`nhl.ts:4`).
- HockeyTech's `modulekit` feed (`hockeytech.ts:8`), for four leagues.

Both can change shape without notice. Today that produces a `TypeError` in the wrong place.

### The specific defect

The adapter contract at `src/lib/server/leagues/types.ts:36-42` is explicit:

```ts
export interface LeagueAdapter {
	id: LeagueId;
	/** The full set of active teams. Throw on failure — the sync layer skips the league. */
	fetchTeams(): Promise<LeagueTeam[]>;
	/** Never throws: failures are reported through the result. */
	fetchRoster(team: LeagueTeam): Promise<RosterResult>;
}
```

`fetchRoster` **can** throw, in both adapters, because the parsing sits outside the `try`.

**`nhl.ts:105-140`.** The `try` ends at line 123 with `data = await res.json()`. Lines 128-139
then run unguarded:

```ts
	data = await res.json();
} catch (err) { /* ... */ return { ok: false, reason: 'transient' }; }
const players = [...data.defensemen, ...data.forwards, ...data.goalies];  // ← line 128
return {
	ok: true,
	players: players.map((p) => ({
		id: p.id,
		firstName: p.firstName.default,   // ← throws if `firstName` is now a string
```

If the NHL renames a position group, the spread throws. If it flattens `firstName` from
`{ default: string }` to `string`, the `.map` throws.

**`hockeytech.ts:133-144`** casts unchecked:

```ts
const value = data?.SiteKit?.[field];
if (value == null) {
	throw new Error(`${label} feed ${params.view} returned no ${field}`);
}
return value as T; // ← line 143
```

The `null` check is the only validation. Then at `:216`, outside the `try` that ends at `:214`:

```ts
const players = parseRosterEntries(entries, () => /* ... */);
```

`parseRosterEntries` calls `entries.filter(...)` at `hockeytech.ts:80`. If `SiteKit.Roster` came
back as an object or a string rather than an array, that throws.

### Why it matters more than it looks

The throws are caught — `once()` at `index.ts:54-56` wraps every sync job in `.catch`. So today
this is a logged error rather than a crash, and the existing data is preserved.

The real costs are subtler:

1. **The failure is misclassified.** A permanent schema change is indistinguishable in the logs
   from a transient network blip. You will not know the NHL changed their API; you will see
   generic sync failures.
2. **It defeats the retry logic.** `syncRoster` at `index.ts:130-136` retries once on
   `reason: 'transient'`. A schema break should never be retried, and a thrown error never
   reaches that classification at all.
3. **It interacts badly with [ABUSE-2](./05-abuse-resistance.md#abuse-2).** Because failures are
   never recorded, a schema break means every home-page load re-fetches a feed that cannot
   possibly succeed.
4. **The contract is documented as a guarantee** and other code is written trusting it.

### The pattern already used correctly

`nhl.ts:150-171` (`fetchTeams`) puts _everything_ inside the `try` — the fetch, the `.json()`,
the `.map`, and the emptiness check — and falls back to the static `ACTIVE_TEAMS` list on any
failure. That is the right shape. `fetchRoster` just does not follow it.

### Action

Add **zod** as a dependency (agreed with the repo owner). Server-only, so bundle size is not a
concern.

1. Define schemas beside each adapter for: NHL standings, NHL roster, HockeyTech seasons,
   HockeyTech `teamsbyseason`, HockeyTech roster.
2. Parse **inside** the existing `try` blocks. Return `{ ok: false, reason: 'not-found' }` or a
   new dedicated reason on a parse failure — deliberately _not_ `'transient'`, so a schema break
   is not retried and is visible as its own class of failure. Adding a `reason: 'invalid'` variant
   to `RosterResult` in `types.ts:28-34` is the cleanest expression of this; the union is already
   documented per-variant and extends naturally.
3. Log parse failures distinctly, including the zod issue path. "NHL roster schema changed at
   `forwards[0].firstName`" is the log line that saves you an afternoon.
4. Replace the hand-written interfaces with `z.infer`: `NHLStandingsResponse` (`nhl.ts:82-88`),
   `NHLPlayer` (`:90-97`), `NHLRosterResponse` (`:99-103`), `HockeyTechSeason`
   (`hockeytech.ts:24-31`), `HockeyTechTeam` (`:33-41`), `HockeyTechRosterEntry` (`:43-51`).

> [!IMPORTANT]
> Several of those interfaces carry genuinely useful doc comments that are not derivable from the
> types — `career: "1" for seasons that count (regular season / playoffs)` at
> `hockeytech.ts:27`, `active: "1" while the player is still on the roster` at `:50`, and the
> `teamsbyseason` note at `:33`. Move them onto the schema fields via `.describe()` or a
> preceding comment. Do not lose them in the migration.

5. Be permissive where the feeds are messy. `parseRosterEntries` exists precisely because the
   HockeyTech feeds append junk entries and nested coaching-staff arrays (`hockeytech.ts:87-90`).
   Validate the envelope strictly and the entries loosely — use `.passthrough()` / `.catch()` on
   entry fields rather than rejecting an entire roster because one row is malformed. Rejecting
   the whole payload would be a regression against behaviour that already works.

### Leave alone

`pickCurrentSeason` (`hockeytech.ts:59-66`) and `parseRosterEntries` (`:76-104`) are pure,
exported for testability, and already covered by `hockeytech.test.ts`. They should keep operating
on the now-validated types with no behavioural change. The tests should keep passing untouched —
if they do not, the schemas are too strict.
