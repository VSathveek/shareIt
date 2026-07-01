# Phase 1 — Requirements Review

Status: **Complete — decisions locked (see §6). Ready for Phase 2.**

This document is a critical review of the product brief. Its job is not to agree — it is
to surface contradictions, hidden costs, and physics-level constraints *before* any
architecture is committed.

---

## 1. What is well-specified and non-controversial

- **No accounts / no login / no install** → maps cleanly to a static SPA + WebRTC. Good.
- **P2P-first, no cloud upload on the happy path** → WebRTC DataChannel is the correct core.
- **Modular architecture, add capabilities later** → correct instinct; the transport layer
  (framing, chunking, backpressure, integrity) should be data-type-agnostic so clipboard,
  text, and sync ride the same rails as files.
- **Vercel (frontend) + Railway (signaling)** → correct split. Signaling needs a *persistent*
  WebSocket process, which Vercel's serverless model cannot host. Keeping them separate is right.

## 2. The four requirements that fight each other

These are the decisions that actually shape the system. They are flagged, not silently accepted.

### 2.1 "Resume interrupted transfers" + "no cloud storage" + "unstable connections"

WebRTC is **synchronous and stateful**. A DataChannel only exists while *both* tabs are open
and both peers are online. This has hard consequences the brief glosses over:

- If the sender closes the tab, the transfer is dead — there is no server-side copy to resume from.
- "Resume" therefore can only mean: *both peers reconnect and continue from the last
  acknowledged chunk*, not "come back tomorrow and finish." True store-and-forward async
  transfer **requires** a relay that holds bytes = it breaks "no cloud storage."
- This is a **product decision**, not a technical one. (See open question Q1.)

### 2.2 "500GB / 1TB+ files" in a browser

This is the single most expensive requirement and the one most likely to sink the MVP if
accepted at face value. The constraints:

- **Receiver-side disk write.** You cannot buffer 100GB in RAM or IndexedDB. Streaming to disk
  needs the **File System Access API** (`showSaveFilePicker` + `WritableStream`). That API is
  **Chromium-only.** Safari and Firefox do **not** support it. On those browsers the practical
  ceiling is a few GB (Blob in memory) before the tab dies.
- **Sender-side read** is fine everywhere (`File.stream()` / `Blob.slice()` are universal).
- **Duration.** 1TB at a realistic 200 Mbps p2p link ≈ **11+ hours** of both tabs staying open,
  awake, and on the same network path. Mobile browsers background-throttle and kill this.
- **Resume becomes mandatory, not optional**, purely because transfers this long *will* break.
- **Conclusion:** "1TB in the browser, cross-platform" is not an MVP feature. It is a
  Chromium-desktop feature with a serious resume engine behind it. (See Q2.)

### 2.3 TURN + large files = uncapped bandwidth bill

- ~10–20% of peer pairs cannot connect directly (symmetric NAT, corporate firewalls, some
  mobile carriers) and **must** relay through TURN. TURN relays every byte.
- A single 500GB transfer that falls back to TURN = **1TB of relayed egress** (in + out).
  On managed TURN (~$0.40–0.90/GB) that is **$400–900 for one transfer**. On self-hosted
  (~$0.01–0.09/GB egress) still $10–45.
- Accepting "1TB files" and "works for everyone" simultaneously means accepting unbounded cost.
- **Recommendation:** TURN policy must be *size-aware*. Small payloads relay freely; large
  transfers either (a) refuse to relay and require a direct path, or (b) relay behind a
  per-session byte cap. (See Q3.)

### 2.4 "Works on every browser" vs the feature list

Feature availability is **not** uniform. The honest matrix:

| Capability | Chromium | Firefox | Safari |
|---|---|---|---|
| WebRTC DataChannel | ✅ | ✅ | ✅ |
| Stream-to-disk (File System Access) | ✅ | ❌ | ❌ |
| Large (>few GB) receive | ✅ | ⚠️ mem-bound | ⚠️ mem-bound |
| Clipboard API (rich) | ✅ | ⚠️ | ⚠️ |

The platform should **feature-detect and degrade**, not promise identical behavior everywhere.

## 3. Technology positions (short form; full rationale in Phase 2)

- **Frontend: Vite + React + TypeScript**, *not* Next.js for the MVP. The app is a client-side
  SPA with zero SSR/SEO need; Next.js adds a server runtime and build complexity you don't use.
  (If a marketing site is wanted later, add Next.js for that surface only.)
- **Signaling: Node + TypeScript + raw `ws`** (or Fastify + `@fastify/websocket`), *not*
  Socket.IO. Socket.IO's value is fallback transports and rooms; modern WebRTC signaling needs
  neither and the protocol overhead/tie-in isn't worth it. The signaling payload is tiny
  (SDP + ICE), so the server stays near-stateless.
- **State: in-memory Map for MVP**, Redis **only** when you run more than one signaling instance.
  Do not add Redis on day one.
- **Transfer engine: Web Workers + Streams API + IndexedDB (for resume metadata only)**, with
  File System Access API for the receive sink on Chromium. Keep file bytes off the main thread.
- **Go for signaling?** Not yet. Node handles tens of thousands of idle WebSockets fine and keeps
  one language across the stack. Reconsider Go only if signaling becomes CPU-bound (it won't at
  MVP; it's I/O-bound).

## 4. Scope recommendation for MVP (to be confirmed)

Build the smallest thing that proves the hard part (reliable p2p streaming), then layer up:

- **MVP:** code-based pairing, single + multiple files, drag/drop, direct p2p via public STUN,
  chunked streaming with backpressure + integrity, progress/speed/ETA, cancel. File ceiling
  **capped** (see Q2). Managed TURN wired but off/limited.
- **Growth:** resume engine, folders, QR pairing, pause/resume, self-hosted TURN, local history.
- **Production:** multi-region TURN, signaling horizontal scale + Redis, monitoring, abuse controls.

## 6. Locked decisions

- **Q1 — Sync vs async → SYNCHRONOUS.** Both peers must be online simultaneously. Pure P2P;
  "no cloud storage" holds. Resume means *both peers reconnect and continue from the last
  acknowledged chunk*, never offline store-and-forward.
- **Q2 — File ceiling → 1TB+ target from day one.** Consequences accepted:
  - MVP is **Chromium-desktop-first**; Firefox/Safari receive is feature-detected and capped
    to a memory-safe size with a clear message, not silently broken.
  - The **resume engine is mandatory**, not deferred — long transfers will drop.
  - Receive sink = **File System Access API** (`showSaveFilePicker` + `WritableStream`).
  - **Build sequence to avoid a big-bang stall:** (a) streaming transport core that works to any
    size *within a live session*, then (b) cross-session resume + disk-sink layer on top.
- **Q3 — TURN → Managed provider, size-capped.** Wire a managed TURN provider with a per-session
  relayed-byte cap; transfers above the cap require a direct path. Bounds cost, keeps ~95%+
  connect success, zero server maintenance.
- **Push → skipped for now.** Commits stay local; remote wired later.

## 7. Confirmed MVP scope

Code pairing · single + multiple files + folders · drag/drop · direct p2p (public STUN) with
managed size-capped TURN fallback · Web Worker chunked streaming with backpressure · integrity
verification · progress / speed / ETA · pause / resume / cancel · cross-session resume engine ·
File System Access receive sink (Chromium) with feature-detected degradation elsewhere.

Deferred to Growth/Production: QR pairing, clipboard/text/image types, local history UI,
self-hosted TURN, multi-region, signaling horizontal scale + Redis, monitoring/abuse controls.
