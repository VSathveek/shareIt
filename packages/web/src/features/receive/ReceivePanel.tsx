import { useEffect, useRef, useState } from 'react';
import { sanitizeFilename, type Sink } from '@shareit/shared';
import type { ReceiveTier } from '../../lib/capabilities';
import { useTransferSession } from '../../hooks/useTransferSession';
import { IndexedDbResumeStore } from '../../transfer/indexeddb-resume-store';
import { MemorySink } from '../../transfer/sinks/memory-sink';
import { pickDiskSink } from '../../transfer/sinks/disk-sink';
import { formatBytes } from '../../lib/format';
import { ProgressView } from '../transfer/ProgressView';

interface Props {
  tier: ReceiveTier;
}

/**
 * Receive view. Two steps so the file is saved with its real name/type:
 *   1. enter code → connect (the sender waits before sending bytes),
 *   2. once the file's name is known, a Save click (fresh user gesture) opens the save dialog
 *      with the correct filename, then the transfer proceeds.
 */
export function ReceivePanel({ tier }: Props) {
  const { state, receive } = useTransferSession();
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<'enter' | 'connecting' | 'transferring'>('enter');
  const resolveSink = useRef<((sink: Sink) => void) | null>(null);

  const incoming = state.manifest?.files[0];
  const incomingName = incoming ? sanitizeFilename(incoming.path) : null;

  const connect = () => {
    setPhase('connecting');
    // The receiver awaits this factory before replying `resume`, so nothing streams until Save.
    const sink = () => new Promise<Sink>((resolve) => (resolveSink.current = resolve));
    receive(code.trim().toUpperCase(), { sink, resumeStore: new IndexedDbResumeStore() });
  };

  const save = async () => {
    const name = incomingName ?? 'download';
    let sink: Sink | null = null;
    if (tier === 'streaming') {
      sink = await pickDiskSink(name); // user gesture is live here, with the real filename
    }
    if (!sink) sink = new MemorySink(name);
    resolveSink.current?.(sink);
    setPhase('transferring');
  };

  // Surface a transfer error by returning to the entry screen state via the ProgressView banner.
  useEffect(() => {
    if (state.error && phase === 'connecting') setPhase('transferring');
  }, [state.error, phase]);

  if (phase === 'transferring') {
    return (
      <div className="panel">
        <ProgressView state={state} verb="Receiving" />
      </div>
    );
  }

  if (phase === 'connecting') {
    return (
      <div className="panel">
        {incoming ? (
          <>
            <div className="code-card">
              <span className="code-card__label">Incoming file</span>
              <span className="progress__file">
                <strong>{incomingName}</strong> ({formatBytes(incoming.size)})
              </span>
            </div>
            <button className="btn btn--primary" onClick={save}>
              Save file
            </button>
            {tier === 'memory-limited' && (
              <p className="panel__note">Large files will be capped in this browser.</p>
            )}
          </>
        ) : (
          <p className="progress__status">Connecting… waiting for the sender.</p>
        )}
        {state.error && <div className="banner banner--error">Error: {state.error}</div>}
      </div>
    );
  }

  return (
    <div className="panel">
      <label className="code-input" htmlFor="code">
        <span className="code-input__label">Enter connection code</span>
        <input
          id="code"
          className="code-input__field"
          inputMode="text"
          autoComplete="off"
          placeholder="ABCDEF"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <button className="btn btn--primary" disabled={code.trim().length < 6} onClick={connect}>
        Connect
      </button>
      {tier === 'memory-limited' && (
        <p className="panel__note">Large files will be capped in this browser.</p>
      )}
    </div>
  );
}
