# Phase 7 — WebRTC Connection Layer

Status: **Built & verified (awaiting approval before Phase 8)**

Wraps `RTCPeerConnection` + `RTCDataChannel` into a `PeerConnection` class driven by signals.
This is where the first real peer-to-peer channel opens.

---

## What was built

- **`connection/peer-connection.ts`** — `PeerConnection`:
  - **Role-based flow** — offerer (pairing creator) creates the DataChannel and the offer; answerer
    waits for the offer and replies. Matches the Phase 6 role assignment.
  - **Trickle ICE both ways** — local candidates emitted as `signal`; remote candidates applied.
  - **ICE candidate buffering** — candidates arriving before the remote description is set are
    queued and flushed after `setRemoteDescription`. This is the classic cause of flaky connects.
  - **State surfacing** — maps `RTCPeerConnectionState` → our `ConnectionState`.
  - **`restartIce()`** — offerer re-offers with `{ iceRestart: true }` for network-change recovery.
  - **`ready()`** — promise that resolves with the open DataChannel (binary mode) for the transfer
    engine.
  - `RTCPeerConnection` is **injected** (`rtcFactory`) so all logic is unit-testable in Node.

## Verification

- **30 tests pass** (5 shared · 10 signaling · 15 web), typecheck + lint clean.
- New: 8 `PeerConnection` tests against a mock RTCPeerConnection — offer emission, answer + ICE
  apply, ICE buffering→flush, outward trickle (null candidate ignored), `ready()` on open, answerer
  channel adoption as `arraybuffer`, state mapping, ICE restart.

## Key decisions

- **Offerer owns the DataChannel + offer.** The creator became the offerer in Phase 6 (it receives
  `peer-joined`), so the two phases compose with no glue: `peer-joined` → `start()`.
- **ICE buffering is not optional.** With trickle ICE, candidates routinely beat the SDP answer;
  applying them early throws. Buffering removes a whole class of intermittent failures — and it's
  explicitly tested.
- **Injected `rtcFactory`.** WebRTC has no Node implementation, so a mock is the only way to test
  this deterministically now; real two-browser validation is Phase 11 (E2E). Flagged honestly.
- **`ready()` returns the channel as `arraybuffer`** — the transfer engine needs binary framing; set
  once here so no downstream code has to remember.

## Honest limitations

- Not yet exercised against real browsers (mock only); NAT/firewall/relay paths validate in E2E.
- No automatic `restartIce()` trigger wired to `disconnected`/`failed` yet — the connection layer
  surfaces state; the policy for *when* to restart lives with the transfer engine (Phase 8) so it
  can coordinate with pause/resume.

## What Phase 8 will produce

The **transfer engine + transport core**: the data-type-agnostic framing over the DataChannel,
Web-Worker chunk reading with `bufferedAmount` backpressure, block hashing, and progress/speed/ETA
— the first actual file moving browser-to-browser.
