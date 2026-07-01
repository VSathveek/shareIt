import { useEffect, useRef, useState } from 'react';
import { sanitizeFilename, type Sink } from '@shareit/shared';
import type { ReceiveTier } from '../../lib/capabilities';
import { useTransferSession } from '../../hooks/useTransferSession';
import { IndexedDbResumeStore } from '../../transfer/indexeddb-resume-store';
import { MemorySink } from '../../transfer/sinks/memory-sink';
import { pickDiskSink } from '../../transfer/sinks/disk-sink';
import { ProgressView } from '../transfer/ProgressView';

interface Props {
  tier: ReceiveTier;
}

/**
 * Receive view: enter the code → choose where to save → connect and reassemble the file.
 * Streaming tier saves straight to disk (File System Access); otherwise a memory-backed download.
 */
export function ReceivePanel({ tier }: Props) {
  const { state, receive } = useTransferSession();
  const [code, setCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const memorySink = useRef<MemorySink | null>(null);

  // Once the manifest arrives we know the real filename; apply it to the memory sink's download.
  useEffect(() => {
    const path = state.manifest?.files[0]?.path;
    if (path && memorySink.current) memorySink.current.fileName = sanitizeFilename(path);
  }, [state.manifest]);

  const connect = async () => {
    let sink: Sink | null = null;
    if (tier === 'streaming') {
      sink = await pickDiskSink('shareit-download'); // user gesture: prompt for save location now
    }
    if (!sink) {
      const mem = new MemorySink('shareit-download');
      memorySink.current = mem;
      sink = mem;
    }
    setConnecting(true);
    receive(code.trim().toUpperCase(), { sink, resumeStore: new IndexedDbResumeStore() });
  };

  if (connecting) {
    return (
      <div className="panel">
        <ProgressView state={state} verb="Receiving" />
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
