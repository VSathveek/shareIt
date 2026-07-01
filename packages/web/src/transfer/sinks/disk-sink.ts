import type { Sink } from '@shareit/shared';

/**
 * Streams received bytes straight to disk via the File System Access API — the only way to
 * receive files larger than memory (Chromium; Phase 1 decision). `pickDiskSink` prompts for a
 * save location and returns a ready sink, or null if the API is unavailable.
 */
export class DiskSink implements Sink {
  constructor(private readonly writable: FileSystemWritableFileStream) {}
  async write(chunk: Uint8Array): Promise<void> {
    await this.writable.write(chunk as BufferSource);
  }
  async close(): Promise<void> {
    await this.writable.close();
  }
  async abort(): Promise<void> {
    await this.writable.abort();
  }
}

export async function pickDiskSink(suggestedName: string): Promise<DiskSink | null> {
  const picker = (
    globalThis as {
      showSaveFilePicker?: (opts: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;
  if (!picker) return null;

  const handle = await picker({ suggestedName });
  const writable = await handle.createWritable();
  return new DiskSink(writable);
}
