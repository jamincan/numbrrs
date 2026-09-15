# Load testing the origin

## What this is for

[`docs/hosting.md`](../docs/hosting.md) puts the current machine's sustained
ceiling at **"~5–15 req/s"** and labels it an estimate. That estimate is load
bearing: it is what decides whether a modest Reddit post (~8 req/s) survives and
whether a good one (~33 req/s) does not. This measures it.

The output should be a single number written back into `docs/hosting.md`'s
"Where it breaks" section, replacing the guess.

## Why a staging app rather than production

Load testing production would inject a `pageview` row per request
(`src/hooks.server.ts:147`) into the `events` table, polluting `/admin` and
evicting real visits via the row cap in `src/lib/server/analytics.ts`. A
throwaway app on identical hardware costs pennies and avoids all of it.

`fly.staging.toml` keeps the `[[vm]]` and `[http_service.concurrency]` blocks
byte-identical to the root `fly.toml`. If you change one, change both, or the
number stops transferring.

## Why the `.fly.dev` hostname, not `numbrrs.app`

Cloudflare sits in front of the apex domain. Testing through it measures cache
hit ratio and Cloudflare's capacity — worth knowing, but a different question.
The origin's ceiling is the unknown, so the test goes straight at `.fly.dev`,
which has no CDN in front of it. `k6-origin.js` refuses to run against
`numbrrs.app` for this reason.

## Steps

### 1. Install k6

```powershell
winget install k6.k6
```

### 2. Deploy the throwaway app

`numbrrs-loadtest` may already be taken — app names are global on Fly. Pick
another and update `app =` in `fly.staging.toml` if `create` complains.

```bash
fly apps create numbrrs-loadtest
fly secrets set ADMIN_TOKEN=$(openssl rand -hex 32) -a numbrrs-loadtest
fly deploy -c load-test/fly.staging.toml
```

### 3. Warm it before measuring

A fresh database means the first request to each team triggers an upstream
roster sync, with the 8s `BLOCKING_TIMEOUT` from
`src/lib/server/leagues/index.ts` in the path. Measuring that measures the NHL's
API, not this app.

Log into `/admin` on the staging app with the token from step 2 and press
resync. Wait for it to report complete, then hit each URL in `TEAMS` once by
hand and confirm they render. Only then measure.

### 4. Run the ramp

```bash
k6 run -e BASE_URL=https://numbrrs-loadtest.fly.dev load-test/k6-origin.js
```

Watch `fly logs -a numbrrs-loadtest` and `fly status -a numbrrs-loadtest` in
another terminal at the same time. The interesting failure on a 256MB box is
**OOM or connection shedding, not slow responses** — latency alone will not tell
you which one you hit.

### 5. Destroy it

```bash
fly apps destroy numbrrs-loadtest
```

Check `fly volumes list -a numbrrs-loadtest` first if you added a mount. This
config has none, so there should be nothing left billing.

## Result, 2026-07-29

| State                         | Sustained rate   | p50  | p95   | Failures |
| ----------------------------- | ---------------- | ---- | ----- | -------- |
| Burst credits available       | **100 req/s**    | 12ms | 24ms  | 0%       |
| Credits drained (~25min load) | **~17–20 req/s** | 12ms | 10.3s | 0.04%    |

Zero failures, zero restarts, no OOM across 20,207 requests. Written up in
[`docs/hosting.md`](../docs/hosting.md)'s "Where it breaks".

**One wrong turn worth recording**, because it looked like a real result. A flat
sweep sized VUs as `RATE * 20`, which allocated 2000 VUs for the 100 req/s run and
reported a 62% failure rate. That was the load generator running out of sockets,
not the server: the giveaway was achieved throughput plateauing at 17–34 req/s
_regardless of target_, while the server stayed healthy with a green health check
and no shedding in its logs. Sane VU sizing dropped failures to 0.39% at the same
rate. If a run shows failures, confirm them from the server's side before
believing them.

## Reading the result

The ceiling is the first stage where p95 climbs sharply or `route_failures`
leaves zero — not the stage where k6 prints a threshold failure, which is a
fixed 1s/1% line chosen in advance rather than a property of the machine.

Three things that would invalidate a run:

- **k6 warns about insufficient VUs.** Past that point you measured the load
  generator. Raise `maxVUs` and re-run.
- **Your own connection saturated.** At 100 req/s of ~30KB HTML this is roughly
  24 Mbps inbound. If your link cannot sustain that, the top stage is measuring
  your ISP.
- **The stage was too short.** Fly's shared CPU has burst credits. A stage that
  passes for 30s and fails at 2m was riding credits, which is why the stages are
  two minutes.
