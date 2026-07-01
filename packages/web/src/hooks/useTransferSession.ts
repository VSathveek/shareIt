import { useCallback, useRef, useState } from 'react';
import type { ConnectionState, Manifest, TransferProgress } from '@shareit/shared';
import { TransferSession, type ReceiveOptions } from '../connection/session';
import { SIGNALING_URL } from '../lib/config';

export interface TransferUiState {
  code: string | null;
  connection: ConnectionState;
  progress: TransferProgress | null;
  manifest: Manifest | null;
  sas: string | null;
  done: boolean;
  error: string | null;
}

const INITIAL: TransferUiState = {
  code: null,
  connection: 'idle',
  progress: null,
  manifest: null,
  sas: null,
  done: false,
  error: null,
};

/** React binding over TransferSession: exposes UI state plus send/receive actions. */
export function useTransferSession() {
  const [state, setState] = useState<TransferUiState>(INITIAL);
  const sessionRef = useRef<TransferSession | null>(null);

  const bind = useCallback((session: TransferSession) => {
    session.on('code', (code) => setState((s) => ({ ...s, code })));
    session.on('state', (connection) => setState((s) => ({ ...s, connection })));
    session.on('progress', (progress) => setState((s) => ({ ...s, progress })));
    session.on('manifest', (manifest) => setState((s) => ({ ...s, manifest })));
    session.on('sas', (sas) => setState((s) => ({ ...s, sas })));
    session.on('done', () => setState((s) => ({ ...s, done: true })));
    session.on('error', (err) => setState((s) => ({ ...s, error: err.message })));
  }, []);

  const send = useCallback(
    (file: File) => {
      setState(INITIAL);
      const session = new TransferSession({ signalingUrl: SIGNALING_URL });
      sessionRef.current = session;
      bind(session);
      session.send(file);
    },
    [bind],
  );

  const receive = useCallback(
    (code: string, options: ReceiveOptions) => {
      setState(INITIAL);
      const session = new TransferSession({ signalingUrl: SIGNALING_URL });
      sessionRef.current = session;
      bind(session);
      session.receive(code, options);
    },
    [bind],
  );

  return { state, send, receive };
}
