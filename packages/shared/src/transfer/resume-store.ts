/**
 * Persistence for resuming an interrupted transfer. Only the receiver persists, and only tiny
 * metadata — never file bytes (those stream to the sink). Keyed by `transferId`, which both
 * peers derive deterministically (Phase 2, §2.7).
 */
export interface ResumeRecord {
  transferId: string;
  durableOffset: number;
}

export interface ResumeStore {
  load(transferId: string): Promise<ResumeRecord | null>;
  save(record: ResumeRecord): Promise<void>;
  clear(transferId: string): Promise<void>;
}

/** In-memory store for tests and non-persistent sessions. */
export class InMemoryResumeStore implements ResumeStore {
  private readonly records = new Map<string, ResumeRecord>();

  load(transferId: string): Promise<ResumeRecord | null> {
    return Promise.resolve(this.records.get(transferId) ?? null);
  }
  save(record: ResumeRecord): Promise<void> {
    this.records.set(record.transferId, { ...record });
    return Promise.resolve();
  }
  clear(transferId: string): Promise<void> {
    this.records.delete(transferId);
    return Promise.resolve();
  }
}
