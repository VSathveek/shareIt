/** Wire chunk size: the safe cross-browser SCTP message size for DataChannel.send. */
export const DEFAULT_CHUNK_SIZE = 16 * 1024;

/** Integrity block size: unit of hashing and resume checkpointing (Phase 2, §4). */
export const DEFAULT_BLOCK_SIZE = 8 * 1024 * 1024;
