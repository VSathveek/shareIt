import type { ResumeRecord, ResumeStore } from '@shareit/shared';

/**
 * Browser `ResumeStore` backed by IndexedDB. Stores only tiny `{ transferId, durableOffset }`
 * records (never file bytes) so an interrupted large transfer can continue after a reload —
 * paired with a `DiskSink` reopened at the saved offset.
 */
export class IndexedDbResumeStore implements ResumeStore {
  constructor(
    private readonly dbName = 'shareit',
    private readonly storeName = 'resume',
  ) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(this.storeName, { keyPath: 'transferId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(this.storeName, mode).objectStore(this.storeName));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }

  async load(transferId: string): Promise<ResumeRecord | null> {
    const record = await this.run<ResumeRecord | undefined>('readonly', (s) => s.get(transferId));
    return record ?? null;
  }

  async save(record: ResumeRecord): Promise<void> {
    await this.run('readwrite', (s) => s.put(record));
  }

  async clear(transferId: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(transferId));
  }
}
