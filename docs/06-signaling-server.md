# Phase 6 — Signaling Server

Status: **Built & verified (awaiting approval before Phase 7)**

The first true end-to-end slice: two browsers discover each other by code and relay SDP/ICE. No
media bytes touch the server — only tiny signaling traffic.

---

## What was built

### Server (`packages/signaling`)

- **`pairing/code.ts`** — crypto-random 6-char codes from an unambiguous alphabet (no I/L/O/0/1);
  `isValidCodeFormat` for cheap input rejection.
- **`ws/session-store.ts`** — `SessionStore` **interface** + `InMemorySessionStore` (`code → peer`
  map, peer index, counterpart lookup, disconnect cleanup, pending-session reaping). The interface
  is the Redis seam for multi-instance scale.
- **`turn/credentials.ts`** — `buildIceServers`: STUN always; managed **TURN with short-TTL
  HMAC-SHA1 credentials** (coturn `use-auth-secret` scheme) when a secret is configured.
- **`ws/hub.ts`** — `SignalingHub`: transport-agnostic pairing + relay logic (create / join /
  signal / disconnect), fully unit-testable with fake peers.
- **`ws/route.ts`** — thin `@fastify/websocket` adapter turning each socket into a `Peer`.
- **`config.ts`** — extended with STUN/TURN settings; **fails fast** on bad `PORT`/`TURN_TTL`.
- **`index.ts`** — pending-session reaper (10-min TTL) + graceful shutdown.

### Client (`packages/web`)

- **`connection/signaling-client.ts`** — `SignalingClient`: owns the WebSocket, **buffers sends
  until open**, **reconnects with backoff**, and emits typed events (`created`, `peer-joined`,
  `peer-left`, `signal`, `error`, `state`). Framework-agnostic; socket + timer are injectable.

## Protocol (recap)

```
create ─▶            ◀─ created { code, iceServers }
        join { code } ─▶   ◀─ created { code, iceServers }   (to joiner)
                           ─▶ peer-joined                    (to creator → starts offer)
signal { sdp|ice } ─▶ relayed to counterpart ▶ signal { … }
(disconnect) ─▶ peer-left to the other side
```

## Verification

- **22 tests pass**, typecheck + lint clean.
- Unit: pairing codes, TURN credential HMAC (deterministic), hub pairing/relay/errors/disconnect,
  client buffering/events/reconnect/explicit-close.
- **Live integration test**: two real `ws` clients connect to a listening server, pair by code, and
  relay an SDP offer through it.

## Key decisions

- **Hub logic separated from the socket** — pairing/relay is pure enough to test without a network;
  `route.ts` is a 15-line adapter. Same SOLID seam pattern as `buildServer()`.
- **Both peers receive `created` (ICE config); only the creator receives `peer-joined`** — the
  creator is the WebRTC offerer, so `peer-joined` is its cue to start; the joiner waits for the
  offer. Clean role assignment with no extra message types.
- **`counterpart()` relay** — the server never parses SDP/ICE; it forwards opaque payloads, keeping
  it privacy-preserving and future-proof (any signal type works).
- **Client buffers + reconnects** — pairing survives a flaky setup connection; injectable timer
  makes backoff deterministically testable.

## Honest limitations

- No auth/rate-limiting yet on `create`/`join` (brute-force + abuse controls are Phase 10). Payload
  is capped at 64 KB as a first abuse blunt.
- Reconnect re-opens the socket but does not auto-re-issue `create`/`join` (a server session is
  gone after disconnect); the app re-initiates. Fine for MVP.

## What Phase 7 will produce

The **WebRTC connection layer**: `PeerConnection` wrapping `RTCPeerConnection` + `RTCDataChannel`,
driven by `SignalingClient` — offer/answer, trickle ICE, DTLS/SCTP bring-up, connection-state
surfacing, and ICE restart on network change. First real peer-to-peer channel open.
