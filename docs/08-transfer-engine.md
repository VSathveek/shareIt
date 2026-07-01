# Phase 8 — Transfer Engine + Transport Core

Status: **Built & verified (awaiting approval before Phase 9)**

The heart of the product: bytes actually move. The engine is channel-agnostic and lives in
`shared` (fully Node-testable); the browser glue is thin.

---

## What was built

### Core (`packages/shared`)

- **`transport/backpressure.ts`** — `BackpressuredWriter` over a `ChannelLike`. After a send pushes
  `bufferedAmount` past the high-water mark, `write` parks until `bufferedamountlow`. This bounds
  in-flight memory to a few MB regardless of file size — the mechanism that makes 1TB possible.
- **`transfer/integrity.ts`** — `sha256Hex` (Web Crypto, works in Node ≥ 20 and browsers) + a flat
  `merkleRoot` over block hashes. Per-block, because SubtleCrypto can't stream a whole-file digest.
- **`transfer/channel.ts`** — `TransferChannel`, `Source`, `Sink` seams the engine talks to.
- **`transfer/sender.ts`** — `TransferSender`: manifest → per block { data frames, block marker } →
  complete. Reads a block, hashes it, sends 16KB chunks with backpressure, then the marker.
  Cooperative pause/cancel checked at each chunk.
- **`transfer/receiver.ts`** — `TransferReceiver`: reassembles blocks, **verifies each hash before
  writing**, acks the durable offset, checks the whole-file root at the end. Messages are processed
  on a **serial promise chain** so async verification never races the next message.

### Browser glue (`packages/web`)

- **`transfer/data-channel-transport.ts`** — adapts an RTCDataChannel (control = JSON string,
  data = binary via the backpressured writer; buffers pre-subscription messages).
- **`transfer/sources/file-source.ts`** — ranged reads from a `File` (never fully in memory).
- **`transfer/sinks/disk-sink.ts`** — streams to disk via File System Access (`pickDiskSink`).
- **`transfer/sinks/memory-sink.ts`** — buffer-then-download fallback for FF/Safari.

## The headerless-framing insight

Data frames carry **no per-frame header** — just raw bytes. Because the DataChannel is
**reliable + ordered**, a `block` control marker is guaranteed to arrive after all of that block's
data frames, so the receiver knows exactly where each block ends without offsets in every frame.
This removes ~all framing overhead on the hot path (meaningful over 1TB) and is the same ordering
property that let resume collapse to a single offset (Phase 2).

## Verification

- **40 tests** (shared 12 · signaling 10 · web 18), typecheck + lint clean.
- Highlight: a **full sender→receiver round-trip over an in-memory loopback** transfers a multi-block
  file byte-for-byte with real SHA-256 verification; a **tamper test** flips a byte in flight and
  asserts the receiver rejects it and never closes the sink. Plus backpressure park/resume,
  progress-reaches-total, integrity vectors, and the DataChannel adapter routing.

## Key decisions

- **Engine in `shared`, not `web`.** Orchestration is pure; keeping it out of the browser means the
  whole transfer protocol is tested deterministically in Node against a loopback — the tamper and
  round-trip tests are the payoff.
- **Verify-before-write.** The receiver hashes a block and only then writes to the sink, so corrupt
  data never lands on disk. Costs one 8MB buffer; worth it.
- **Cooperative pause/cancel at chunk boundaries.** Simple and predictable vs interrupting mid-send.

## Honest limitations

- **Single file per job** so far. The manifest already models `files[]`; multi-file/folder is a
  sequencing loop over this core (a later phase), not new protocol.
- **Resume is not wired yet** — the receiver already acks `durableOffset`; consuming it to skip
  already-sent blocks on reconnect is Phase 9.
- Web Worker offloading of read/hash is not in place; the seams (`Source`, engine) are Worker-ready
  but the engine currently runs on the calling thread. Fine for correctness; Phase 13 optimization.

## What Phase 9 will produce

The **resume engine**: persist `{ transferId, durableOffset }` to IndexedDB on the receiver, exchange
a resume point on reconnect, and have the sender rewind its `Source` to continue — closing the loop
on the "transfers survive drops" promise for large files.
