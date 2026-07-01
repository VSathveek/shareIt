/**
 * Send view shell. Pairing-code generation, drag-drop, and the transfer engine wire in
 * during Phases 6–8; this establishes the layout and the "get a code, share it" flow.
 */
export function SendPanel() {
  return (
    <div className="panel">
      <div className="dropzone" aria-label="Drop files to send">
        <p className="dropzone__hint">Drag files or a folder here</p>
        <p className="dropzone__sub">or click to choose</p>
      </div>
      <div className="code-card">
        <span className="code-card__label">Your connection code</span>
        <span className="code-card__value" aria-live="polite">
          — — — —
        </span>
        <p className="code-card__note">Share this code with the person receiving.</p>
      </div>
    </div>
  );
}
