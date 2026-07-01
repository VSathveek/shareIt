import { useRef, useState, type DragEvent } from 'react';
import { useTransferSession } from '../../hooks/useTransferSession';
import { ProgressView } from '../transfer/ProgressView';

/**
 * Send view: pick/drop a file → get a connection code to share → the transfer starts once the
 * receiver joins.
 */
export function SendPanel() {
  const { state, send } = useTransferSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [started, setStarted] = useState(false);

  const pick = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setStarted(true);
    send(file);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    pick(e.dataTransfer.files);
  };

  if (!started) {
    return (
      <div className="panel">
        <div
          className="dropzone"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <p className="dropzone__hint">Drag a file here</p>
          <p className="dropzone__sub">or click to choose</p>
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          onChange={(e) => pick(e.target.files)}
        />
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="code-card">
        <span className="code-card__label">Your connection code</span>
        <span className="code-card__value" aria-live="polite">
          {state.code ?? '····'}
        </span>
        <p className="code-card__note">Share this code with the person receiving.</p>
      </div>
      <ProgressView state={state} verb="Sending" />
    </div>
  );
}
