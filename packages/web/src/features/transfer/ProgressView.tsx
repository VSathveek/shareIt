import type { TransferUiState } from '../../hooks/useTransferSession';
import { formatBytes, formatEta, formatSpeed } from '../../lib/format';

interface Props {
  state: TransferUiState;
  verb: string; // "Sending" | "Receiving"
}

/** Shared progress display: connection status, file, bar, speed/ETA, SAS, done/error. */
export function ProgressView({ state, verb }: Props) {
  const { progress, manifest, connection, sas, done, error } = state;
  const file = manifest?.files[0];
  const pct =
    progress && progress.totalBytes > 0
      ? Math.round((progress.bytesTransferred / progress.totalBytes) * 100)
      : 0;

  return (
    <div className="progress">
      <div className="progress__status">
        Connection: <strong>{connection}</strong>
      </div>

      {file && (
        <div className="progress__file">
          {verb} <strong>{file.path}</strong> ({formatBytes(file.size)})
        </div>
      )}

      {progress && !done && (
        <>
          <div className="progress__bar" role="progressbar" aria-valuenow={pct}>
            <div className="progress__fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="progress__meta">
            <span>{pct}%</span>
            <span>{formatSpeed(progress.bytesPerSecond)}</span>
            <span>ETA {formatEta(progress.etaSeconds)}</span>
          </div>
        </>
      )}

      {sas && (
        <div className="progress__sas">
          Verification code: <strong>{sas}</strong> — confirm it matches on both devices.
        </div>
      )}

      {done && <div className="banner banner--ok">Transfer complete.</div>}
      {error && <div className="banner banner--error">Error: {error}</div>}
    </div>
  );
}
