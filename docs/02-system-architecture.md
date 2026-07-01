# Phase 2 — System Architecture

Status: **In review (awaiting approval before Phase 3)**

Design only. No application code is introduced in this phase. Decisions from
[Phase 1](01-requirements-review.md) are treated as fixed: synchronous P2P, 1TB target,
Chromium-first with graceful degradation, managed size-capped TURN.

---

## 1. Architectural principle: a data-type-agnostic transport

The single most important decision for the long-term vision (clipboard, text, sync, screen,
audio later) is this: **the transport core must not know it is moving files.** It moves framed
messages and byte streams between two peers. A *file* is just one `Source`/`Sink` adapter plugged
into that transport.

This gives a clean layering where every future capability reuses the same chunking, backpressure,
integrity, and resume machinery:

```
┌─────────────────────────────────────────────────────────────┐
│ UI layer (React)          components, hooks, view state       │
├─────────────────────────────────────────────────────────────┤
│ Application / Transfer     orchestrates a transfer job:       │
│   engine                   chunking, integrity, progress,     │
│                            flow control, resume               │
├───────────────┬─────────────────────────────────────────────┤
│ Source/Sink   │ File source · disk sink (FSA) · memory sink   │
│ adapters      │ · (future) clipboard/text/stream adapters     │
├───────────────┴─────────────────────────────────────────────┤
│ Transport core             message framing protocol over the  │
│   (type-agnostic)          DataChannel, ordering, backpressure │
├─────────────────────────────────────────────────────────────┤
│ Connection layer           RTCPeerConnection lifecycle, ICE,  │
│                            DataChannel, reconnection, ICE      │
│                            restart                             │
├─────────────────────────────────────────────────────────────┤
│ Signaling client  ⇄  Signaling server (SDP/ICE, pairing)      │
└─────────────────────────────────────────────────────────────┘
        (bytes never traverse our servers on the direct path)
```

Rule enforced by boundaries: **the transport core depends on nothing above it.** The transfer
engine depends on transport + adapters via interfaces, never on concrete WebRTC types.

---

## 2. Module catalogue

Each module below lists Purpose · Responsibilities · Interface (illustrative TS) · Tradeoffs ·
Future scalability.

### 2.1 Signaling Server

- **Purpose:** Introduce two browsers so they can build a direct connection. Nothing else.
- **Responsibilities:** issue pairing codes; hold a short-lived map `code → waiting peer socket`;
  relay SDP offers/answers and ICE candidates between the two peers of a session; mint short-TTL
  TURN credentials; expire idle sessions.
- **Interface (WebSocket message protocol, not REST):**
  ```
  → create            ← created { code }
  → join { code }     ← peer-joined | error { reason }
  → signal { sdp | candidate }   ← signal { sdp | candidate }   (relayed to the other peer)
  → bye               (connection teardown)
  ```
- **Tradeoffs:** in-memory map = trivially simple, but state is per-instance (scaling note §6).
  Raw `ws` over Socket.IO = smaller, no transport fallback we don't need.
- **Future scalability:** stateless except for the ephemeral pairing map; sessions live seconds.
  Scale by consistent-hashing the code so both peers land on the same instance (§6) — avoids Redis
  until very large scale.

### 2.2 Signaling Client

- **Purpose:** Browser-side counterpart; owns the WebSocket to the signaling server.
- **Responsibilities:** connect/reconnect with backoff; send/receive signaling messages; surface
  connection-code lifecycle to the UI; hand SDP/ICE to the Connection layer.
- **Interface:** `SignalingClient.create()`, `.join(code)`, `.onSignal(cb)`, `.sendSignal(msg)`,
  events: `paired`, `peer-left`, `error`.
- **Tradeoffs:** WebSocket reconnection must not lose an in-progress WebRTC session — signaling is
  only needed at setup and for ICE restarts, so a dropped signaling socket mid-transfer is
  survivable as long as the DataChannel holds.

### 2.3 Connection Layer

- **Purpose:** Own the `RTCPeerConnection` and `RTCDataChannel` lifecycle end to end.
- **Responsibilities:** create offer/answer; apply local/remote descriptions; trickle ICE;
  configure the DataChannel (reliable, ordered); expose connection state; perform **ICE restart**
  on network change; drive reconnection.
- **Interface:**
  ```ts
  interface PeerConnection {
    connect(role: 'offerer' | 'answerer'): Promise<DataChannelHandle>;
    onStateChange(cb: (s: ConnectionState) => void): void;
    restartIce(): Promise<void>;   // network change / path failure
    close(): void;
  }
  ```
- **Tradeoffs:** DataChannel in **reliable + ordered** mode (see §4) trades a little
  head-of-line-blocking risk for drastically simpler resume logic (cumulative offset, no gap
  tracking). Correct choice for bulk file transfer.
- **Future scalability:** per-connection, no shared state; scales with clients, not servers.

### 2.4 Transport Core (data-type-agnostic)

- **Purpose:** A tiny framing protocol on top of the DataChannel so multiple logical streams and
  control messages share one channel.
- **Responsibilities:** frame/deframe messages `{ type, streamId, seq, payload }`; multiplex
  control vs data; expose a writable stream with **backpressure** wired to `bufferedAmount`.
- **Interface:**
  ```ts
  interface Transport {
    sendControl(msg: ControlMessage): void;
    openStream(streamId: string): BackpressuredWriter; // pauses on high-water mark
    onStream(cb: (streamId: string, reader: StreamReader) => void): void;
    onControl(cb: (msg: ControlMessage) => void): void;
  }
  ```
- **Tradeoffs:** a custom minimal frame header (a few bytes) beats JSON-per-chunk (which would
  waste ~30% overhead and CPU on a 1TB transfer). Control messages stay JSON; data frames are
  binary with a compact header.
- **Future scalability:** clipboard/text/screen become new stream types + adapters, zero changes
  here — this is the payoff of the abstraction.

### 2.5 Transfer Engine

- **Purpose:** Orchestrate one file/folder transfer job over the transport.
- **Responsibilities:** build the transfer **manifest**; drive the chunk manager; compute/verify
  block integrity; track progress/speed/ETA; own pause/resume/cancel; coordinate the resume
  protocol with its peer.
- **Interface:**
  ```ts
  interface TransferEngine {
    send(files: FileList, transport: Transport): TransferHandle;
    receive(manifest: Manifest, transport: Transport, sink: Sink): TransferHandle;
  }
  interface TransferHandle {
    pause(): void; resume(): void; cancel(): void;
    on(event: 'progress' | 'done' | 'error' | 'paused', cb): void;
  }
  ```
- **Tradeoffs:** engine is pure orchestration — no WebRTC, no DOM. Fully unit-testable with a
  fake transport. This is where SOLID pays off.

### 2.6 Chunk Manager

- **Purpose:** Deterministic slicing of a source into addressable chunks/blocks.
- **Responsibilities:** map `offset ⇄ chunkIndex` with fixed chunk size; group chunks into
  integrity **blocks**; feed the reader in a **Web Worker** so the main thread never touches file
  bytes; transfer `ArrayBuffer`s zero-copy via `postMessage`.
- **Tradeoffs:** fixed chunk size = deterministic addressing → simple resume math. Reading in a
  Worker keeps the UI at 60fps during a 1TB read.

### 2.7 Resume Engine

- **Purpose:** Continue a broken transfer from the last durably-written point, within the
  both-peers-online model.
- **Responsibilities:** receiver persists `{ transferId, durableOffset }` (and open file handle
  reference) to **IndexedDB** after each flushed block; on reconnect exchanges a `RESUME` control
  message; sender rewinds its reader to the receiver's `durableOffset`.
- **Design note — why cumulative offset, not a bitmap:** because the DataChannel is
  **reliable + ordered**, in-session bytes arrive complete and in sequence. Loss only happens when
  the whole connection drops. So a single monotonically-increasing "durably written up to N"
  checkpoint is sufficient — no per-chunk SACK bitmap needed. Much simpler and correct.
- **Tradeoffs:** IndexedDB stores only *metadata* (kilobytes), never file bytes — bytes stream
  straight to disk via the sink. Resume across a full browser restart also needs the user to
  re-grant the file handle (permission model), which we surface explicitly.

### 2.8 Integrity Module

- **Purpose:** Detect corruption without holding 1TB in memory.
- **Responsibilities:** **block-level SHA-256** (e.g. 8MB blocks) computed by the sender before
  send and verified by the receiver on write; optional Merkle root over block hashes for a
  whole-file guarantee in the final manifest.
- **Why not one whole-file hash:** `SubtleCrypto.digest` has **no streaming/incremental API**, so
  a single hash would require buffering the entire file — impossible at 1TB. Per-block native
  hashing is fast, streams, and doubles as resume/partial-verification granularity.

### 2.9 Encryption Module

- **Purpose:** Confidentiality and integrity of the media path.
- **Responsibilities:** rely on WebRTC's mandatory **DTLS-SRTP / DTLS-over-SCTP** for the media
  path (E2E between browsers by construction — our servers never see plaintext bytes). Optionally
  layer an application-level key derived from an out-of-band short code (SAS-style) to defend
  against a malicious signaling server performing MITM. (See Phase 10.)
- **Tradeoffs:** DTLS alone is E2E *if* signaling is trusted. The optional short-authentication
  layer removes trust in our own server at the cost of a verification step in the UI.

### 2.10 Source / Sink Adapters

- **File Source:** `File.stream()` / `Blob.slice()` — universal across browsers.
- **Disk Sink (primary):** File System Access API `showSaveFilePicker()` → `WritableStream` —
  streams to disk, unbounded size. **Chromium only.**
- **Memory Sink (fallback):** accumulate to a Blob, `URL.createObjectURL` download — Firefox/Safari,
  capped to a memory-safe size with an explicit UI warning.
- **Future adapters:** clipboard, text, MediaStream — same `Source`/`Sink` contract.

### 2.11 UI Layer

- **Purpose:** The "just works" experience.
- **Responsibilities:** code display/entry, drag-drop, progress/speed/ETA, pause/resume/cancel,
  QR (Growth), browser-capability messaging. Thin; all logic lives below it.

---

## 3. WebRTC connection lifecycle (exact sequence)

```
Sender (offerer)                 Signaling                 Receiver (answerer)
  create() ───────────────────▶ store code
                                  ◀───────────── join(code)
  createDataChannel(reliable,ordered)
  createOffer / setLocalDesc
  ── signal(offer) ───────────▶ relay ─────────▶ setRemoteDesc(offer)
                                                  createAnswer / setLocalDesc
  setRemoteDesc(answer) ◀────── relay ◀────────── signal(answer)
  ◀───── ICE candidates trickle both ways via signaling ──────▶
  DTLS handshake over SCTP  (E2E encryption established)
  datachannel.onopen  ────────  transfer engine takes over  ── datachannel.onopen
```

- **ICE:** gather **host** (LAN), **server-reflexive/srflx** (via STUN), and **relay** (via TURN)
  candidates; connectivity checks pick the best pair, preferring host > srflx > relay to minimise
  cost and latency. TURN is only used when direct pairs all fail.
- **SDP:** the offer/answer describing codecs/transport; for a data-only app it advertises a single
  `application` m-line (SCTP). No audio/video m-lines in v1.
- **DTLS:** secures the channel; keys never leave the browsers → E2E by construction.
- **SCTP:** the DataChannel transport; we run it **reliable + ordered**.
- **Failure recovery:** on `iceconnectionstate = disconnected/failed` → attempt **ICE restart**
  (new candidates, same session) before tearing down; if the DataChannel closes, fall to the
  resume protocol and rebuild via signaling.
- **Mobile behavior:** backgrounded tabs get throttled/suspended; we detect `visibilitychange`,
  checkpoint resume state aggressively, and on return attempt ICE restart rather than a cold rebuild.

---

## 4. Flow control, chunk sizing, backpressure

- **Chunk size on the wire:** **16 KiB** per `DataChannel.send()` is the safe cross-browser SCTP
  message size. (Chromium supports larger via SCTP fragmentation, but 16 KiB keeps interop and
  smooth backpressure; we can negotiate a larger size when both peers are Chromium.)
- **Integrity block size:** **8 MiB** (512 wire-chunks) — the unit of hashing and resume checkpoint.
- **Backpressure (the core of not blowing up memory):**
  ```
  read source → hash block → send 16KiB frames
     if datachannel.bufferedAmount > HIGH (e.g. 16 MiB): pause the reader
     datachannel.bufferedAmountLowThreshold = LOW (e.g. 1 MiB)
     on 'bufferedamountlow' → resume the reader
  ```
  This bounds in-flight memory to a few MiB regardless of file size — the mechanism that makes
  1TB possible.
- **Congestion control:** handled by SCTP itself; we don't reimplement it. Our job is only to not
  overfill the send buffer (backpressure above) and to not starve it.

---

## 5. Resume protocol (wire-level)

```
On (re)connect, before/along with data:
  Receiver ─ RESUME { transferId, durableOffset } ─▶ Sender
  Sender rewinds reader to durableOffset, resends from there
During transfer:
  Receiver flushes block to disk sink → persists {transferId, durableOffset} to IndexedDB
  Receiver ─ ACK { durableOffset } ─▶ Sender   (every N blocks; progress + checkpoint)
On completion:
  Sender ─ MANIFEST_COMPLETE { merkleRoot } ─▶ Receiver → final verify → done
```

`transferId = hash(fileName + size + lastModified + sessionSalt)` so both peers derive the same id
and can match a resumed transfer deterministically.

---

## 6. Scaling path (10 → 1,000,000) and bottlenecks

| Scale | Signaling | Session state | STUN/TURN | Notes / bottleneck |
|---|---|---|---|---|
| 10–1k | 1 Railway instance | in-memory Map | public STUN + managed TURN | nothing to do; sessions live seconds |
| 1k–10k | 1 larger instance | in-memory | same | WebSockets are mostly idle; cheap. Add health checks + graceful restart |
| 10k–100k | N instances + LB | **route both peers to same instance by hashing the code** | managed TURN, spend alerts | avoids shared state entirely; Redis still not required |
| 100k–1M | N instances, multi-region | consistent hashing; Redis pub/sub only if cross-instance discovery truly needed | **multi-region TURN** | real cost/bottleneck is **TURN bandwidth**, not signaling |

- **Key scaling insight:** because file bytes flow **peer-to-peer**, our servers carry ~zero
  transfer traffic on the happy path. Signaling is I/O-bound and tiny (SDP+ICE, then silence).
  This is what lets a solo dev serve large numbers cheaply.
- **The only expensive axis is TURN relay** (the ~15–20% who can't go direct). Controlled by:
  short-TTL credentials minted by signaling, size-cap policy, provider spend alerts, and
  eventually self-hosted regional coturn when relay volume justifies owning it.
- **WebSocket scaling:** vertical first (one box handles tens of thousands of idle sockets), then
  horizontal with code-hash routing. **TURN scaling:** horizontal + regional, billed per GB.
  **Global deployment:** signaling near users for setup latency; TURN regional for relay latency/cost.

---

## 7. Honest limitations recorded now

- **True hard per-session TURN byte cap** isn't fully enforceable with a managed provider from the
  client; MVP uses short-TTL creds + client policy + provider budget alerts. A guaranteed hard cap
  needs self-hosted coturn (deferred, Phase 12+).
- **Firefox/Safari large receive** is memory-bound; those users get a capped experience by design.
- **Resume across full browser restart** requires re-granting the file handle (browser permission
  model) — surfaced in UI, not silently assumed.

---

## 8. What Phase 3 will produce

The concrete monorepo folder structure (frontend / signaling / shared transport packages),
package boundaries that enforce the layering above, tooling (TS project references, lint, format,
test), and the shared type contracts (`Manifest`, `ControlMessage`, `ConnectionState`) that both
peers and both packages import.
