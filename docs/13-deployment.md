# Phase 13 — Deployment

Status: **Built & verified (awaiting approval before Production hardening)**

Near-zero-maintenance MVP: static web app on Vercel, one small signaling container on Railway.
No database, no cluster, no daily ops (Phase 1 constraints).

---

## What was built

- **`vercel.json`** (repo root) — monorepo build: `npm ci`, build `@shareit/shared` then
  `@shareit/web`, output `packages/web/dist`, SPA rewrites to `index.html`.
- **`Dockerfile`** (repo root) — signaling image: installs the workspace, builds `shared`, runs
  `npm run start -w @shareit/signaling`. Reads `PORT` (Railway injects it). `.dockerignore` keeps
  the context lean.
- **`railway.json`** — Dockerfile builder + `/health` health check + restart policy.
- **`packages/web/.env.example`** — `VITE_SIGNALING_URL`.

## Topology

```
Browser ──HTTPS──▶ Vercel (static SPA)
Browser ──WSS───▶ Railway (signaling container)  ──mints──▶ managed TURN creds
   └──────────── WebRTC DTLS/SCTP peer-to-peer (file bytes, never our servers) ──────────┘
```

## Environment variables

### Railway (signaling)

| Var | Purpose | Example |
|---|---|---|
| `PORT` | injected by Railway | (auto) |
| `ORIGIN_ALLOWLIST` | lock WS to the web origin | `https://shareit.vercel.app` |
| `TURN_URLS` | managed TURN endpoint(s) | `turn:global.turn.provider:3478` |
| `TURN_SECRET` | HMAC secret for short-TTL creds | (secret) |
| `TURN_TTL` | credential lifetime (s) | `86400` |
| `CREATE_PER_MIN` / `JOIN_PER_MIN` | rate limits | `20` / `30` |
| `LOG_LEVEL` | pino level | `info` |

### Vercel (web)

| Var | Purpose | Example |
|---|---|---|
| `VITE_SIGNALING_URL` | signaling WSS URL (build-time) | `wss://shareit.up.railway.app/ws` |

## Deploy steps

1. **Push to GitHub** (CI runs: build, lint, test).
2. **Railway** → New Project → Deploy from repo (uses `Dockerfile`/`railway.json`). Set the env
   vars above. Note the public URL → its `/health` should return `ok`.
3. **Vercel** → Import repo (root = repo root; `vercel.json` drives the build). Set
   `VITE_SIGNALING_URL` to the Railway `wss://…/ws`. Deploy.
4. **Close the loop:** set Railway `ORIGIN_ALLOWLIST` to the Vercel production URL and redeploy.
5. **First real E2E:** open the site in two browsers/devices and run the Phase 11 manual checklist.

## Verification done here

- The production start command (`npm run start -w @shareit/signaling`) boots and `/health` returns
  `{"status":"ok"}` locally — the exact command the container runs.
- `vercel.json` build steps mirror the verified local `build` (shared → web) that produces
  `packages/web/dist`.

## Key decisions

- **Web and signaling deploy independently.** The SPA is static (Vercel CDN); signaling is the only
  always-on process (one small Railway container). This is the cheapest shape that supports
  persistent WebSockets, which Vercel's serverless model can't host.
- **`tsx` at runtime, no separate build step for signaling.** Fewer moving parts for the MVP;
  compiling to JS (tsup) is a later optimization if cold-start/image-size matters.
- **Health check + restart policy** give self-healing without any ops.

## Honest limitations

- **Single signaling instance.** Fine to ~10k concurrent (Phase 2 scaling table). Beyond that needs
  horizontal scale + code-hash routing (and Redis only if truly required) — not MVP.
- **Managed TURN cost is the real variable.** Watch provider spend; the size-cap policy and
  short-TTL creds bound abuse but not a determined heavy user (Phase 1/2 caveat).
- **Image includes dev deps** (tsx/typescript needed to run/build). Acceptable for MVP; slim via a
  compiled runtime later.

## What Production hardening (next) will produce

Monitoring/logging (structured logs, uptime + error alerts), Cloudflare in front of Railway,
graceful-shutdown/liveness polish, a self-hosted `coturn` path for TURN cost control at scale, and
a runbook — the operational layer for real traffic.
