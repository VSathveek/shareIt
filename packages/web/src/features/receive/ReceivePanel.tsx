import type { ReceiveTier } from '../../lib/capabilities';

interface Props {
  tier: ReceiveTier;
}

/**
 * Receive view shell. Code entry + connection + disk/memory sink wire in during Phases 6–10.
 */
export function ReceivePanel({ tier }: Props) {
  return (
    <div className="panel">
      <label className="code-input" htmlFor="code">
        <span className="code-input__label">Enter connection code</span>
        <input
          id="code"
          className="code-input__field"
          inputMode="text"
          autoComplete="off"
          placeholder="ABCD"
          maxLength={8}
        />
      </label>
      <button className="btn btn--primary" disabled>
        Connect
      </button>
      {tier === 'memory-limited' && (
        <p className="panel__note">Large files will be capped in this browser.</p>
      )}
    </div>
  );
}
