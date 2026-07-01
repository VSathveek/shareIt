import {
  DEFAULT_BLOCK_SIZE,
  DEFAULT_CHUNK_SIZE,
  sha256Hex,
  transferIdInput,
  type FileEntry,
  type Manifest,
} from '@shareit/shared';

/**
 * Builds the sender-side manifest for a file. The receiver adopts `transferId` from the manifest
 * (it has no file to derive it from), so only the sender computes it — from the file's identity
 * plus a random salt, so re-sending the same file in a new session gets a fresh id.
 */
export async function createManifest(
  file: File,
  salt: string = crypto.randomUUID(),
  chunkSize: number = DEFAULT_CHUNK_SIZE,
  blockSize: number = DEFAULT_BLOCK_SIZE,
): Promise<Manifest> {
  const entry: FileEntry = {
    path: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };
  const input = transferIdInput(entry, salt);
  const bytes = new TextEncoder().encode(input);
  const transferId = await sha256Hex(bytes);
  return { transferId, files: [entry], chunkSize, blockSize };
}
