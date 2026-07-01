# Phase 3 — Folder Structure

Status: **In review (awaiting approval before Phase 4)**

Design only. This defines the repository layout, the package boundaries that *enforce* the
Phase 2 layering, tooling, and the shared type contracts. No feature code yet.

---

## 1. Why a monorepo with three packages

Two browsers run the *same* transport/transfer logic, and the signaling server shares message
types with the client. If these lived in separate repos we would duplicate the wire contracts and
drift. So: **one pnpm workspace, three packages.**

```
shareit/
├─ packages/
│  ├─ shared/        pure TS: wire contracts, framing, no DOM, no Node APIs
│  ├─ signaling/     Node service: WebSocket pairing + TURN creds
│  └─ web/           browser SPA: Vite + React, imports shared
├─ docs/
├─ .github/workflows/   CI (Phase 12)
├─ package.json         workspace root
├─ pnpm-workspace.yaml
├─ tsconfig.base.json   shared compiler options
├─ .eslintrc.cjs / eslint.config.js
├─ .prettierrc
└─ README.md
```

- **pnpm workspaces** over npm/yarn: content-addressed store (fast, disk-cheap), strict
  `node_modules` that prevents phantom dependencies — which is exactly how we keep the layering
  honest.
- **TypeScript project references** so `web` and `signaling` consume `shared` as a typed,
  incrementally-built project, and a layering violation is a *compile error*, not a convention.

## 2. `packages/shared` — the type-agnostic core (no DOM, no Node)

This package is the heart of the "add capabilities without rewrites" goal. It must import
**nothing** platform-specific so it can run in the browser, in a Web Worker, and in Node tests.

```
packages/shared/src/
├─ protocol/
│  ├─ control-messages.ts   ControlMessage union (CREATE, JOIN, SIGNAL, RESUME, ACK, ...)
│  ├─ framing.ts            binary frame header encode/decode (streamId, seq, type)
│  └─ manifest.ts           Manifest, FileEntry, transferId derivation
├─ transport/
│  ├─ transport.ts          Transport interface + framing impl (channel-agnostic)
│  └─ backpressure.ts       high/low watermark writer contract
├─ transfer/
│  ├─ chunker.ts            offset⇄index math, block grouping (pure functions)
│  └─ integrity.ts          block hashing + Merkle root helpers (Web Crypto via injected impl)
├─ types/
│  ├─ connection-state.ts   ConnectionState enum, events
│  └─ transfer-state.ts     progress/speed/ETA value types
└─ index.ts                 public surface
```

- **Boundary rule:** `shared` has no dependency on `web` or `signaling`. Enforced by project
  references (it references neither) and an ESLint `no-restricted-imports` rule.
- Platform primitives it needs (crypto, the actual channel) are passed in as **injected
  interfaces**, never imported — keeps it universal and unit-testable in Node.

## 3. `packages/signaling` — the Node service

```
packages/signaling/src/
├─ server.ts            bootstrap: HTTP + WebSocket upgrade
├─ ws/
│  ├─ connection.ts     per-socket handler, message parse/validate
│  └─ session-store.ts  code → peer map (in-memory; interface allows Redis later)
├─ pairing/
│  └─ code.ts           short unambiguous code generation (no 0/O/1/l)
├─ turn/
│  └─ credentials.ts    short-TTL HMAC TURN creds (coturn REST format)
├─ config.ts            env-driven config (PORT, TURN_SECRET, ORIGIN allowlist)
└─ index.ts
```

- **`SessionStore` is an interface** with an in-memory implementation now and a Redis
  implementation later (Phase, only at 100k+). The rest of the code never knows which.
- Imports `@shareit/shared` for `ControlMessage` types → server and client validate the *same*
  contract.
- **Tooling:** Fastify (HTTP health + `@fastify/websocket`) or raw `ws` behind a thin `http`
  server. Leaning Fastify for the free health endpoint, structured logging, and graceful shutdown
  — decided concretely in Phase 6.

## 4. `packages/web` — the browser SPA

```
packages/web/src/
├─ app/                 shell, routing (send / receive / paired views)
├─ features/
│  ├─ pairing/          code create/enter UI + hook
│  ├─ transfer/         progress, speed/ETA, pause/resume/cancel UI
│  └─ dropzone/         drag-drop + file/folder selection
├─ connection/
│  ├─ signaling-client.ts   WebSocket client (reconnect/backoff)
│  └─ peer-connection.ts    RTCPeerConnection/DataChannel lifecycle, ICE restart
├─ transfer/
│  ├─ engine.ts             TransferEngine orchestration (uses shared)
│  ├─ worker/               chunk-reader.worker.ts, hasher.worker.ts (off-main-thread bytes)
│  └─ sinks/                disk-sink.ts (FSA), memory-sink.ts (fallback), capability.ts
├─ state/                app store (progress, connection status)
├─ lib/                  qr, formatBytes, feature-detect
├─ main.tsx
└─ index.html
```

- **Layer mapping to Phase 2:** `connection/` = Connection layer; `transfer/engine.ts` +
  `worker/` + `sinks/` = Transfer engine + adapters; framing/contracts come from `shared`. The UI
  in `features/` holds no transport logic.
- **Workers** live beside the code that owns them; file bytes never reach `features/` or `state/`.
- **Vite** for dev/build → static output to Vercel. No Next.js (Phase 1 decision).

## 5. Shared type contracts (the spine both sides compile against)

Illustrative — the actual definitions land in Phase 6/7, but the *contract locations* are fixed
now so every module targets them:

```ts
// shared/protocol/control-messages.ts
type ControlMessage =
  | { t: 'create' }
  | { t: 'created'; code: string; turn: IceServer[] }
  | { t: 'join'; code: string }
  | { t: 'peer-joined' }
  | { t: 'signal'; data: RTCSessionDescriptionInit | RTCIceCandidateInit }
  | { t: 'resume'; transferId: string; durableOffset: number }
  | { t: 'ack'; transferId: string; durableOffset: number }
  | { t: 'error'; reason: string };

// shared/protocol/manifest.ts
interface Manifest { transferId: string; files: FileEntry[]; chunkSize: number; blockSize: number; }
interface FileEntry { path: string; size: number; lastModified: number; blockHashes?: string[]; }
```

## 6. Tooling & conventions

- **TypeScript** strict everywhere; `tsconfig.base.json` extended per package; project references
  for incremental builds and enforced boundaries.
- **ESLint** (typescript-eslint) + **Prettier**; a `no-restricted-imports` rule bans upward/lateral
  imports that would break the layering.
- **Vitest** as the test runner (same config style across packages; fast, ESM-native, works for
  the pure `shared` logic and the Node signaling service).
- **Node ≥ 20 / pnpm** pinned via `packageManager` and `engines`.
- **Path aliases:** packages import each other as `@shareit/shared`, never by relative `../../`.

## 7. Boundary enforcement summary

| From ↓ / May import → | shared | signaling | web |
|---|---|---|---|
| **shared** | — | ❌ | ❌ |
| **signaling** | ✅ | — | ❌ |
| **web** | ✅ | ❌ | — |

Violations fail the build (project references) and lint (`no-restricted-imports`). This is what
keeps the architecture from rotting into a monolith as features are added.

## 8. What Phase 4 will produce

The signaling **backend** foundation is the natural first buildable slice (the client can't pair
without it): workspace + tooling scaffolded for real, `@shareit/shared` contracts stubbed, and the
signaling service's server bootstrap + config + health endpoint. (Pairing logic and TURN creds are
Phase 6.)
