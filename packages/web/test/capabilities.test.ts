import { describe, expect, it } from 'vitest';
import { detectCapabilities, receiveTier } from '../src/lib/capabilities';

const noop = () => undefined;

describe('detectCapabilities', () => {
  it('reports a full Chromium-like environment', () => {
    const caps = detectCapabilities({
      isSecureContext: true,
      RTCPeerConnection: noop,
      showSaveFilePicker: noop,
      DataTransfer: noop,
    });
    expect(caps).toEqual({
      secureContext: true,
      webRTC: true,
      fileSystemAccess: true,
      dragAndDrop: true,
    });
    expect(receiveTier(caps)).toBe('streaming');
  });

  it('degrades to memory-limited without File System Access (Firefox/Safari)', () => {
    const caps = detectCapabilities({
      isSecureContext: true,
      RTCPeerConnection: noop,
      DataTransfer: noop,
    });
    expect(caps.fileSystemAccess).toBe(false);
    expect(receiveTier(caps)).toBe('memory-limited');
  });

  it('is unsupported without a secure context or WebRTC', () => {
    expect(receiveTier(detectCapabilities({ RTCPeerConnection: noop }))).toBe('unsupported');
    expect(receiveTier(detectCapabilities({ isSecureContext: true }))).toBe('unsupported');
  });
});
