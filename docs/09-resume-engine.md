# Phase 9 — Resume Engine

Status: **Built & verified (awaiting approval before Phase 10)**

Closes the loop on "large transfers survive drops": a broken transfer continues from the last
durably-written byte instead of restarting.

---

## Design change made this phase (and why)

**Dropped the sender-provided whole-file merkle root.** Building resume exposed that after a
reconnect the sender no longer holds the skipped blocks' hashes, so it couldn't compute a
whole-file root without re-reading (and re-hashing) everything already sent — pointless CPU on up
to 1TB. It's also redundant: the receiver already verifies **every** block against the hash the
sender sent, so if all block hashes match and `durableOffset === fileSize`, the file is provably
bit-identical. Completion is now that size check. Simpler, and resume-friendly.

## What was built

### Core (`packages/shared`)

- **`transfer/resume-store.ts`** — `ResumeStore` interface + `InMemoryResumeStore`. Persists only
  `{ transferId, durableOffset }` — never bytes.
- **Protocol** — added `resume { durableOffset }` (receiver → sender, in reply to `manifest`);
  `complete` no longer carries a root.
- **Receiver** — on `manifest`, loads any saved offset and replies with `resume`; after each
  verified block, persists the new offset and acks; on `complete`, asserts
  `durableOffset === total`, closes the sink, and clears the record.
- **Sender** — after sending the manifest, **waits for the `resume` point**, aligns it to a block
  boundary, rewinds its `Source`, and streams only the remainder. Progress/speed account for the
  resumed baseline.

### Browser glue (`packages/web`)

- **`transfer/indexeddb-resume-store.ts`** — `ResumeStore` over IndexedDB for persistence across
  reloads.
- **`DiskSink` / `pickDiskSink(name, startOffset)`** — on resume, reopens with `keepExistingData`
  and seeks past bytes already on disk so the engine's sequential writes append correctly.

## Verification

- **44 tests** (shared 16 · signaling 10 · web 18), typecheck + lint clean.
- Headline: **resume across a dropped connection** — session 1 transfers, the connection is cut
  after the first block commits; session 2 (fresh channels, same store + sink) reads the persisted
  offset, the sender rewinds, and the **full file assembles byte-for-byte**; the record is cleared
  on completion. Plus: store save/load/clear, receiver replies with the persisted offset, sender
  streams only the remainder from the correct byte.

## Key decisions

- **Store/sink advance together, atomically per block** — the receiver writes a block, *then*
  persists the offset, so on any interruption the persisted offset never exceeds bytes on disk.
  That invariant is what makes resume safe regardless of where the drop happens.
- **Cumulative offset, no gap bitmap** — the reliable+ordered channel means loss only happens on a
  full drop, so a single "durable up to N" is sufficient (Phase 2, §2.7).

## Honest limitations

- **Resume needs a persistent sink** — meaningful with `DiskSink` (Chromium). `MemorySink`
  (Firefox/Safari) loses its buffer on reload, so those browsers resume only within a live session.
- **Re-granting the file handle** after a full browser restart is a File System Access permission
  prompt the UI must drive (Phase 10/UI wiring).
- IndexedDB store is covered by interface + in-memory tests here; live IDB behavior validates in the
  Phase 11 E2E pass.

## What Phase 10 will produce

**Security hardening**: signaling rate limiting + brute-force protection on `join`, origin
allowlist enforcement, TURN-abuse controls, filename sanitization, and a documented threat model —
plus the optional short-authentication-string check to remove trust in the signaling server.
