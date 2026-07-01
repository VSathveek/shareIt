# Phase 4 — Backend Foundation

Status: **Built & verified (awaiting approval before Phase 5)**

First phase with real code. Scaffolds the workspace, the type-agnostic `shared` core, and the
signaling service skeleton. Pairing logic + TURN credentials are Phase 6; this is what they plug
into.

---

## Deviation from Phase 3

pnpm is not installed on the dev machine, so we use **npm workspaces** (plain npm) as the Phase-1
fallback allowed. Structure, boundaries, and TS project references are unchanged — only the
package manager differs.

## What was built

- **Workspace root** — `package.json` (npm workspaces, Node ≥ 20), `tsconfig.base.json` (strict:
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`), flat **ESLint** config
  (typescript-eslint + enforced `consistent-type-imports`), **Prettier**.
- **`packages/shared`** — DOM-free, Node-free core:
  - `protocol/control-messages.ts` — `ControlMessage` union (signaling + in-band transfer control).
  - `protocol/manifest.ts` — `Manifest`, `FileEntry`, deterministic `transferIdInput()`.
  - `transfer/chunker.ts` — pure offset⇄index/block addressing with input validation.
  - `types/` — `ConnectionState`, `TransferProgress`, `TransferStatus`.
  - Builds to `dist` via `tsc -b` (composite); 5 unit tests on the chunker pass.
- **`packages/signaling`** — Fastify skeleton:
  - `config.ts` — env-driven, **fails fast** on bad `PORT`.
  - `server.ts` — `buildServer()` (no port bind → testable via `app.inject`), `GET /health`.
  - `index.ts` — bootstrap with **graceful shutdown** on SIGINT/SIGTERM.
  - Health test passes (200 + uptime).

## Verification

`npm run build`, `npm run typecheck`, and `npm test` all pass across both packages.

## Key decisions

- **`buildServer()` separated from the listen/shutdown bootstrap** — routes are testable in-process
  with zero open ports; the lifecycle lives in one place. This is the SOLID seam the WebSocket
  pairing plugs into next.
- **`tsx` for dev and start; `tsc --noEmit` as the build gate** — avoids ESM extension-rewriting
  friction for a small service. Revisit bundling (tsup) only if cold-start matters at scale.
- **`SessionStore`/Redis intentionally absent** — not needed until multi-instance (Phase 2, §6).

## Known issues recorded

- 5 `npm audit` advisories, all in the **dev toolchain** (esbuild dev-server bug via vitest/tsx).
  No production exposure. Deferred; will resolve during the testing phase rather than force a
  breaking `vitest@4` upgrade now.

## What Phase 5 will produce

The **frontend foundation**: `packages/web` scaffolded with Vite + React + TypeScript, the app
shell and send/receive views, capability detection (WebRTC / File System Access), and wiring to
import `@shareit/shared`. No transport logic yet — that is Phases 6–8.
