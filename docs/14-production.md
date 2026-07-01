# Phase 14 — Production Hardening

Status: **Built & verified**

The operational layer for real traffic: correct client IPs behind a proxy, observability, a TURN
cost-control path, and a runbook.

---

## What was built

- **`trustProxy: true`** on Fastify — behind Cloudflare/Railway, `req.ip` becomes the real client
  IP (via `X-Forwarded-For`). **This is a correctness fix, not cosmetics:** without it every client
  shares the proxy IP and a single abuser would rate-limit *everyone*.
- **`/metrics`** — JSON counters: `uptime`, `activeSessions`, and cumulative
  `created / joined / relayed / rejected` (tracked in the hub). No Prometheus dependency; scrape or
  poll as needed.
- **Startup config log** — logs port, origin allowlist, whether TURN is enabled, and rate limits on
  boot, so a misconfigured deploy is obvious in the first log line.
- **`deploy/coturn/turnserver.conf`** — self-hosted coturn config for the TURN cost-control path,
  using the same `static-auth-secret` scheme the signaling service mints against.

## Verification

- **67 tests** (shared 29 · signaling 18 · web 20), typecheck + lint clean.
- `/metrics` verified live locally (`{"activeSessions":0,"created":0,...}`); hub metrics unit test
  asserts created/joined/relayed/rejected counting.

## Monitoring & alerting (setup guide)

- **Uptime**: point an uptime monitor (Railway's, or an external one) at `/health`.
- **Metrics**: poll `/metrics`; alert if `activeSessions` pins at 0 during known traffic (signaling
  down) or `rejected` spikes (abuse or a broken client).
- **Logs**: pino JSON to stdout → Railway log drain / your log store. Alert on `error` level.
- **TURN spend**: the real cost lever — set a **provider budget alert**; watch relayed-GB.

## Runbook

| Symptom | Likely cause | Action |
|---|---|---|
| Peers get a code but never connect | STUN/TURN misconfig or all-relay NATs | check ICE servers in `/metrics`-adjacent logs; verify `TURN_URLS`/`TURN_SECRET`; confirm relayed>0 |
| Everyone rate-limited at once | `trustProxy` off / wrong proxy | confirm `trustProxy: true` and that the proxy sets `X-Forwarded-For` |
| `rejected` spiking | brute-force or buggy client | inspect source IPs in logs; tighten `JOIN_PER_MIN` |
| TURN bill climbing | large transfers relaying | verify size-cap policy; consider self-hosted coturn (`deploy/coturn`) in-region |
| Signaling crash-looping | bad env (PORT/TURN_TTL) | fail-fast error is in logs; fix env and redeploy |

## Scaling triggers (from Phase 2)

- **> ~10k concurrent** WebSockets on one instance → add instances behind an LB with **code-hash
  routing** (both peers to the same instance); add Redis only if cross-instance discovery is truly
  needed.
- **TURN relayed-GB material** → deploy regional coturn; route clients to the nearest.
- **Rate limits must be global** across instances → move the limiter to a shared store (same seam
  as the session store).

## Key decisions

- **Counters over a metrics framework.** A tiny JSON `/metrics` covers MVP observability with zero
  dependencies; adopt Prometheus/OpenTelemetry when there's something to correlate.
- **coturn documented, not deployed.** Managed TURN stays the default (zero maintenance); the
  self-host path is ready for when bandwidth economics flip.

## Honest limitations

- **Metrics reset on restart** (in-memory counters) — fine for rate/trend via scraping; use the log
  store for durable history.
- No distributed tracing; single-instance assumptions hold until the scaling triggers above.

## Status of the build

All 14 planned phases are complete: requirements → architecture → structure → signaling → frontend
→ WebRTC → transfer engine → resume → security → testing → app wiring → deployment → production
hardening. Remaining before public launch: **real two-browser E2E** (now unblocked), optional
**pause/cancel UI + multi-file/folder**, and connecting the CI/deploy pipelines to the live repo.
