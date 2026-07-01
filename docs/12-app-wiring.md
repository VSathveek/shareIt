# Phase 12 — App Wiring

Status: **Built & verified (awaiting approval before Deployment)**

Connects the UI to the four layers so there is an actual "pick file → share code → transfer"
flow. Inserted before deployment (your call) so we deploy something that works.

---

## What was built

- **`connection/session.ts`** — `TransferSession`: the orchestration controller that ties
  signaling → peer connection → transport → engine.
  - **Sender:** connect → `create` → emit code → on `peer-joined` build the offerer, exchange
    SDP/ICE, open the DataChannel, wrap it in `DataChannelTransport`, build the manifest, stream
    via `TransferSender`.
  - **Receiver:** `join(code)` → on `created` build the answerer, open the channel, feed a
    `TransferReceiver` into the chosen sink.
  - Every collaborator (signaling, peer, transport, sender, receiver) is an **injected factory**
    with real defaults, so the wiring is unit-testable without a browser.
- **`transfer/manifest.ts`** — `createManifest(file)`: derives `transferId` from the file's
  identity + a random salt (sender-side only; the receiver adopts it from the manifest).
- **`hooks/useTransferSession.ts`** — React binding exposing `{ state, send, receive }`.
- **UI** — `SendPanel` (drag/drop or pick → shows code + progress), `ReceivePanel` (enter code →
  choose disk/memory sink → progress), and a shared `ProgressView` (status, %, speed, ETA, SAS,
  done/error). `lib/format.ts` for human byte/speed/ETA strings; `lib/config.ts` for
  `VITE_SIGNALING_URL`.
- Small enabling tweaks to tested layers: receiver gained an `onManifest` callback; `MemorySink`
  filename is now settable (applied from the manifest so downloads get the real name).

## The two browser-gesture / naming subtleties handled

- **File System Access needs a user gesture.** `showSaveFilePicker` is called at the **Connect
  click**, before the manifest arrives — so the save prompt has a valid user activation. The
  generic suggested name is fine because the OS dialog lets the user name it.
- **MemorySink name comes later.** For the memory fallback, the download name isn't known until the
  manifest arrives, so the sink's `fileName` is updated (sanitized) via `onManifest`.

## Verification

- **65 tests** (shared 29 · signaling 16 · web 20), typecheck + lint clean, web bundle builds.
- New `session.test.ts` (2 tests) drives the controller with fakes: sender emits the code, starts
  the offerer on `peer-joined`, forwards signals both ways; receiver joins and starts the answerer
  on `created`.

## Honest limitations

- **Not yet run against real browsers.** The controller is validated by compile + the wiring test +
  the 63 layer tests; a real two-peer transfer (NAT, DTLS, disk sink) is the deferred Phase-11 E2E,
  now unblocked because the app is wired.
- **Single file per transfer** (multi-file/folder is a sequencing layer over this).
- **No pause/cancel buttons in the UI yet** — the engine supports them; wiring the controls is a
  small follow-up.
- SAS is shown but the app doesn't yet *block* on user confirmation (advisory display).

## What Deployment (next) will produce

Vercel config for the web app (with `VITE_SIGNALING_URL`), a Dockerfile + Railway config for
signaling, env/secrets docs, health-check wiring, and the production `originAllowlist` / managed
TURN setup — a live, low-maintenance MVP that can finally be exercised end-to-end in real browsers.
