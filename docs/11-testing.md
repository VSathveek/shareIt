# Phase 11 — Testing

Status: **Built & verified (awaiting approval before Phase 12)**

---

## Scope decision (challenge to the original plan)

The plan called for a Playwright two-peer browser E2E this phase. I deferred it, deliberately:
**the web UI (Phase 5) is still placeholder panels — not wired to the connection layer or transfer
engine.** An automated browser test needs a working app to drive; today there's nothing to click
through to a real transfer. Standing up a heavy Playwright + WebRTC harness now would test a shell,
not the product.

So this phase hardens what's genuinely testable and defers browser E2E until after the app is wired
(recommended as the next build-out). The harness plan is documented below so it's a small task then.

## What was built

- **Engine edge cases** (`transfer-edge.test.ts`, 7 tests):
  - empty file (0 bytes), single byte, exact block-boundary multiple (512 = 2 blocks),
  - partial final block + partial final chunk (613), chunk size that doesn't divide the block (60),
  - **cancel mid-transfer** → receiver aborts its sink and errors,
  - **pause then resume** → still completes byte-for-byte.
- **CI** (`.github/workflows/ci.yml`): on every push to `main` and every PR — `npm ci`,
  `npm run build` (also type-checks all packages), `npm run lint`, `npm test`.

## Current test coverage (63 tests)

| Area | Tests |
|---|---|
| shared: chunker, integrity, backpressure, round-trip, resume, edge, security | 29 |
| signaling: health, code, credentials, hub, integration (live WS), security | 16 |
| web: capabilities, signaling-client, peer-connection, data-channel-transport | 18 |

All deterministic, run in Node in ~seconds. The live-WebSocket signaling integration test is the
closest thing to E2E that runs today without a browser.

## Deferred: automated two-peer browser E2E (harness plan)

Enable once the app UI is wired (SignalingClient + PeerConnection + engine → UI):

1. Add `@playwright/test`; `playwright.config.ts` with a `webServer` running `npm run dev`.
2. A spec that opens **two browser contexts**, creates a code in one, enters it in the other, and
   drives a real file transfer — asserting the received bytes/hash match. Chromium covers the
   File System Access sink; a Firefox project covers the memory-sink fallback.
3. Run in CI on a schedule/nightly (browser downloads make it heavier than the unit job).

## Manual two-peer smoke checklist (until automated)

- [ ] Open the app in two browsers/devices; create a code in A, enter it in B.
- [ ] Small file (1 KB) transfers; received bytes match.
- [ ] Large file streams to disk on Chromium without memory growth.
- [ ] Kill Wi-Fi mid-transfer, reconnect → resumes from last offset (Chromium/DiskSink).
- [ ] Firefox/Safari receiver shows the memory-limited banner and caps large files.
- [ ] SAS code matches on both ends.

## Key decisions

- **Deterministic engine tests over flaky browser tests.** The subtle correctness lives in the
  engine (framing, integrity, resume) and is fully covered in Node. Browser tests will validate
  wiring and real NAT/relay, not protocol correctness.
- **CI runs `build` to type-check.** Each package's build is its `tsc` gate, so one `npm run build`
  covers compilation across the monorepo plus the web bundle.

## Honest limitations

- No coverage yet of **real browser WebRTC / NAT traversal / TURN relay** — only the mock-driven
  connection layer and the live WS signaling test. That gap closes with the deferred E2E harness.
- CI can't run until a Git remote exists (the workflow is committed and ready).

## What Phase 12 will produce

**Deployment**: Vercel config for the web app, a Dockerfile + Railway config for signaling,
environment/secrets documentation, health-check wiring, and the production `originAllowlist` / TURN
setup — the path to a live, low-maintenance MVP.
