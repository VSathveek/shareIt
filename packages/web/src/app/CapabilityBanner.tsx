import type { ReceiveTier } from '../lib/capabilities';

interface Props {
  tier: ReceiveTier;
}

/**
 * Tells the user the truth about their browser (Phase 1: no false promises of identical
 * behavior everywhere). Streaming = full experience, so no banner.
 */
export function CapabilityBanner({ tier }: Props) {
  if (tier === 'streaming') return null;

  if (tier === 'memory-limited') {
    return (
      <div className="banner banner--warn" role="status">
        Your browser can receive files, but can’t stream very large files to disk. Large transfers
        are capped. For unlimited size, use a Chromium-based browser (Chrome, Edge).
      </div>
    );
  }

  return (
    <div className="banner banner--error" role="alert">
      This browser can’t make peer-to-peer connections (WebRTC unavailable or the page isn’t
      served over HTTPS). Transfers are disabled.
    </div>
  );
}
