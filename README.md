# shareIt

Browser-to-browser peer-to-peer transfer platform. No accounts, no installs, no cloud
uploads on the happy path — a sender and receiver pair with a short code and stream data
directly between browsers over an end-to-end-encrypted WebRTC DataChannel.

**Version 1** targets file and folder transfer. The transport layer is being designed to be
data-type-agnostic so later capabilities (clipboard, text, sync, screen/audio) reuse the same
chunking, backpressure, integrity, and resume machinery without a rewrite.

## Status

Early design. See [`docs/`](docs/) — currently at **Phase 1: Requirements Review**.

## Planned architecture (high level)

- **Frontend** — static SPA (Vite + React + TypeScript), deployed on Vercel.
- **Signaling** — small Node + TypeScript WebSocket service (SDP/ICE exchange only), on Railway.
- **Transport** — WebRTC DataChannel, STUN for NAT traversal, TURN as fallback relay.
- **No persistent server-side storage of user data.**

## Repository layout

```
docs/     Design documents, one per phase
```

