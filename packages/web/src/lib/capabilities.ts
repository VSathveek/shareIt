/**
 * Browser capability detection. The Phase 1 decision (1TB target, Chromium-first with
 * graceful degradation) means we must feature-detect and tell the user the truth about what
 * their browser can do — never promise identical behavior everywhere.
 *
 * Detection reads globals via an injected `env` so it is unit-testable in Node.
 */

export interface Capabilities {
  /** HTTPS or localhost — WebRTC and File System Access both require it. */
  secureContext: boolean;
  /** RTCPeerConnection available. */
  webRTC: boolean;
  /** File System Access API — streaming receive to disk (Chromium only). */
  fileSystemAccess: boolean;
  /** Drag-and-drop file input support. */
  dragAndDrop: boolean;
}

/** What kind of *receive* experience this browser can offer. */
export type ReceiveTier = 'streaming' | 'memory-limited' | 'unsupported';

export interface CapabilityEnv {
  isSecureContext?: boolean;
  RTCPeerConnection?: unknown;
  showSaveFilePicker?: unknown;
  DataTransfer?: unknown;
}

export function detectCapabilities(
  env: CapabilityEnv = globalThis as unknown as CapabilityEnv,
): Capabilities {
  return {
    secureContext: env.isSecureContext === true,
    webRTC: typeof env.RTCPeerConnection === 'function',
    fileSystemAccess: typeof env.showSaveFilePicker === 'function',
    dragAndDrop: typeof env.DataTransfer === 'function',
  };
}

/**
 * Maps capabilities to the honest receive experience:
 * - streaming: can receive arbitrarily large files straight to disk.
 * - memory-limited: WebRTC works but no disk streaming → capped to a memory-safe size.
 * - unsupported: no WebRTC → cannot transfer at all.
 */
export function receiveTier(caps: Capabilities): ReceiveTier {
  if (!caps.secureContext || !caps.webRTC) return 'unsupported';
  return caps.fileSystemAccess ? 'streaming' : 'memory-limited';
}
