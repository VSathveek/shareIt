# Phase 10 — Security Hardening

Status: **Built & verified (awaiting approval before Phase 11)**

---

## What was built

### Signaling (`packages/signaling`)

- **`security/rate-limiter.ts`** — `SlidingWindowLimiter` (per client-IP). Wired into the hub for
  both `create` and `join`; **every** join attempt is counted (including wrong codes), which is what
  caps pairing-code brute force. Defaults: 20 creates/min, 30 joins/min (env-tunable).
- **`security/origin.ts`** — `isOriginAllowed`; the WS route rejects disallowed origins with close
  code 1008 when an allowlist is configured (empty = dev/allow-all).
- **Peer key** — each socket carries a stable rate-limit key (`req.ip`) distinct from its id.
- **Payload cap** — 64 KB max WS message (from Phase 6).

### Shared (`packages/shared`)

- **`security/sanitize.ts`** — `sanitizeFilename` / `sanitizeRelativePath`: strip traversal (`..`),
  separators, drive-relative and control chars, and Windows reserved names — a malicious sender
  controls the manifest, so paths are neutralized before touching a filesystem.
- **`security/sas.ts`** — `parseDtlsFingerprint` + `deriveShortAuthString`: a 6-digit code derived
  from both peers' DTLS fingerprints. Wired into `PeerConnection.authString()`.

## Threat model

| Threat | Vector | Mitigation |
|---|---|---|
| **Eavesdropping on transfer** | network attacker | WebRTC **DTLS-SCTP** — E2E encrypted; bytes never traverse our server on the direct path |
| **MITM by our signaling server** | server swaps SDP | **SAS**: users compare a 6-digit code from DTLS fingerprints out-of-band; mismatch = tampering |
| **Pairing-code brute force** | guess codes via `join` | 30^6 code space + **per-IP join rate limit** on every attempt |
| **Session-creation flooding** | spam `create` | per-IP create rate limit + pending-session reaper (Phase 6) |
| **Cross-site abuse of signaling** | other origins open WS | **origin allowlist** enforced at upgrade |
| **Oversized/abusive messages** | huge SDP/junk | 64 KB payload cap; strict message validation |
| **Path traversal / malicious filenames** | crafted manifest paths | **filename/path sanitization** before any disk write |
| **TURN relay abuse** | steal relay bandwidth | **short-TTL HMAC credentials** minted per session (Phase 6); size-cap policy |
| **Corrupted / tampered data** | flipped bytes in transit | **per-block SHA-256** verified before write (Phase 8) |
| **Malicious file content** | receiver runs the file | out of scope: we never execute content; sanitized names + browser download sandbox; AV is the OS's job |

## Verification

- **56 tests** (shared 22 · signaling 16 · web 18), typecheck + lint clean.
- New: sanitize (traversal/illegal/reserved), SAS (fingerprint parse + stable order-independent
  code), rate limiter (limit/slide/independent keys), origin allowlist, and hub rejects create/join
  under limit.

## Key decisions

- **Rate-limit the *attempt*, not just failures.** Counting every `join` (including wrong codes) is
  what actually bounds brute force; only limiting failures lets an attacker probe freely on hits.
- **SAS over trusting our own server.** DTLS already gives E2E if signaling is honest; the SAS lets
  privacy-conscious users verify our server didn't MITM — genuine zero-trust, optional in the UI.
- **Sanitize on the receiver.** The sender is untrusted; the receiver owns where bytes land, so
  sanitization belongs there, right before the sink.

## Honest limitations

- **Hard per-session TURN byte cap** still isn't enforceable with a managed provider (Phase 1/2
  note): short-TTL creds + spend alerts, not a guaranteed cap.
- Rate limits are **per-instance in-memory**; at multi-instance scale they need a shared store
  (Redis) to be global — same seam as the session store.
- **SAS requires UI**: the derivation is wired; surfacing the compare-this-code step is a UI task in
  the integration phase.

## What Phase 11 will produce

**Testing**: broaden coverage into integration/E2E — a browser-driven two-peer transfer
(Playwright), edge cases (empty files, exact block-boundary sizes, cancel mid-transfer), and CI
wiring so the suite runs on every push.
