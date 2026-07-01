/** Lifecycle of a peer connection, surfaced to the UI (see Phase 2, §3). */
export type ConnectionState =
  | 'idle'
  | 'signaling'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'failed'
  | 'closed';
