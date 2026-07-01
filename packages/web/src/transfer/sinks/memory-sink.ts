import type { Sink } from '@shareit/shared';

/**
 * Fallback `Sink` for browsers without the File System Access API (Firefox/Safari): buffers the
 * whole file in memory then triggers a download. Only safe up to a memory-bound cap — the UI
 * warns and enforces that (Phase 1 degradation).
 */
export class MemorySink implements Sink {
  private parts: Uint8Array[] = [];
  /** Mutable so the app can set the real name once the manifest arrives. */
  constructor(public fileName: string) {}

  write(chunk: Uint8Array): Promise<void> {
    this.parts.push(chunk);
    return Promise.resolve();
  }

  close(): Promise<void> {
    const blob = new Blob(this.parts as BlobPart[]);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName;
    a.click();
    URL.revokeObjectURL(url);
    this.parts = [];
    return Promise.resolve();
  }

  abort(): Promise<void> {
    this.parts = [];
    return Promise.resolve();
  }
}
