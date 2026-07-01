# Phase 5 — Frontend Foundation

Status: **Built & verified (awaiting approval before Phase 6)**

Stands up `packages/web` (Vite + React + TypeScript): app shell, send/receive views, honest
capability detection, and `@shareit/shared` wiring. No transport logic yet — that is Phases 6–8.

---

## What was built

- **`packages/web`** on Vite 5 + React 18 + strict TS, output static (Vercel-ready).
- **`lib/capabilities.ts`** — injectable feature detection (`detectCapabilities`, `receiveTier`)
  for secure context, WebRTC, File System Access, drag-and-drop. Maps to a truthful receive tier:
  `streaming` (disk, unlimited) / `memory-limited` (FF/Safari, capped) / `unsupported`. 3 tests.
- **App shell** — `App`, `ModeSwitch` (Send/Receive tabs), `CapabilityBanner` (tells the user the
  truth per Phase 1), and `SendPanel` / `ReceivePanel` view scaffolds (code card, dropzone,
  code entry) with no logic wired yet.
- **Styling** — one small dark-theme stylesheet; no UI framework pulled in for a scaffold.

## Verification

`npm run typecheck`, `npm test` (9 tests across all packages), and `npm run build` (web → `dist`,
~47 kB gzipped) all pass.

## Key decisions

- **Capability detection is injectable** (`detectCapabilities(env)`) so the branch that decides
  "can this browser stream 1TB to disk?" is unit-tested in Node without a real browser. This is the
  Phase 1 "no false promises" rule turned into testable code.
- **Vite pinned to v5, not v6** — vitest bundles vite 5, and mixing majors installed two copies of
  vite whose plugin types conflicted (a real typecheck failure we hit and fixed). Pinning to one
  vite major dedupes to a single copy. Revisit vite 6 when vitest's bundled vite advances.
- **No component-render tests / jsdom yet** — logic worth testing (capabilities) is pure; DOM tests
  arrive with real interaction in later phases, avoiding a jsdom dependency for a scaffold.
- **Feature folders** (`features/send`, `features/receive`) hold view shells only; all transport
  logic will live under `connection/` and `transfer/` (Phase 3 boundaries), keeping the UI thin.

## What Phase 6 will produce

The **signaling server** proper: WebSocket endpoint, pairing-code generation and the
`code → waiting peer` session store, SDP/ICE relay between paired peers, TURN-credential minting,
and the browser-side `SignalingClient` — the first end-to-end "two browsers find each other" slice.
