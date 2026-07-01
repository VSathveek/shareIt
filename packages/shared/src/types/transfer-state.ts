/** Progress snapshot emitted by the transfer engine for the UI. */
export interface TransferProgress {
  transferId: string;
  bytesTransferred: number;
  totalBytes: number;
  bytesPerSecond: number;
  etaSeconds: number;
}

export type TransferStatus =
  | 'pending'
  | 'transferring'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'error';
