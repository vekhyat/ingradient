import {
  StorageError,
  assertRecordVersion,
  decodeRecord,
  decodeSummary,
  encodeRecord,
  summarise,
  type SavedRecord,
  type SavedSummary,
} from './records';

/**
 * Minimal table operations the store needs. The app uses an encrypted
 * SQLite table; tests use an in-memory table with injected failures.
 */
export interface RecordTable {
  put(row: StoredRow): Promise<void>;
  get(id: string): Promise<StoredRow | null>;
  listSummaries(): Promise<
    Pick<StoredRow, 'id' | 'schemaVersion' | 'savedAt' | 'summary'>[]
  >;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  count(): Promise<number>;
}

export interface StoredRow {
  id: string;
  schemaVersion: number;
  savedAt: string;
  summary: string;
  body: string;
}

export interface SnapshotStore {
  save(record: SavedRecord): Promise<SavedSummary>;
  list(): Promise<SavedSummary[]>;
  get(id: string): Promise<SavedRecord>;
  remove(id: string): Promise<void>;
  eraseAll(): Promise<void>;
  count(): Promise<number>;
}

/**
 * Saved results on this phone (STO-01).
 *
 * `save` resolves only after the row has been written and read back
 * byte-for-byte, so "Saved on this phone" is never shown for a write that
 * did not land. Delete and erase are confirmed the same way.
 */
export function createSnapshotStore(table: RecordTable): SnapshotStore {
  return {
    async save(record) {
      const body = encodeRecord(record);
      const summary = summarise(decodeRecord(record.id, body));
      try {
        await table.put({
          id: record.id,
          schemaVersion: record.schemaVersion,
          savedAt: record.savedAt,
          summary: JSON.stringify(summary),
          body,
        });
      } catch (error) {
        throw new StorageError(
          'write_failed',
          `Could not save: ${(error as Error).message}`,
        );
      }
      const stored = await table.get(record.id);
      if (
        stored === null ||
        stored.body !== body ||
        stored.id !== record.id ||
        stored.schemaVersion !== record.schemaVersion ||
        stored.savedAt !== record.savedAt ||
        stored.summary !== JSON.stringify(summary)
      ) {
        throw new StorageError(
          'write_failed',
          'The save could not be confirmed on this phone.',
        );
      }
      return summary;
    },

    async list() {
      const rows = await table.listSummaries();
      const summaries = rows.map(({ id, schemaVersion, savedAt, summary }) => {
        assertRecordVersion(schemaVersion);
        const decoded = decodeSummary(id, summary);
        if (decoded.savedAt !== savedAt) {
          throw new StorageError(
            'corrupt',
            `Saved result ${id} has inconsistent metadata.`,
          );
        }
        return decoded;
      });
      return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
    },

    async get(id) {
      const row = await table.get(id);
      if (row === null) {
        throw new StorageError('not_found', `Saved result ${id} is not here.`);
      }
      assertRecordVersion(row.schemaVersion);
      const record = decodeRecord(id, row.body);
      const summary = decodeSummary(id, row.summary);
      const expected = summarise(record);
      if (
        row.id !== id ||
        row.savedAt !== record.savedAt ||
        row.schemaVersion !== record.schemaVersion ||
        (Object.keys(expected) as (keyof SavedSummary)[]).some(
          (key) => summary[key] !== expected[key],
        )
      ) {
        throw new StorageError(
          'corrupt',
          `Saved result ${id} has inconsistent metadata.`,
        );
      }
      return record;
    },

    async remove(id) {
      try {
        await table.remove(id);
      } catch (error) {
        throw new StorageError(
          'write_failed',
          `Could not delete: ${(error as Error).message}`,
        );
      }
      if ((await table.get(id)) !== null) {
        throw new StorageError(
          'write_failed',
          'The delete could not be confirmed.',
        );
      }
    },

    async eraseAll() {
      try {
        await table.clear();
      } catch (error) {
        throw new StorageError(
          'write_failed',
          `Could not erase: ${(error as Error).message}`,
        );
      }
      if ((await table.count()) !== 0) {
        throw new StorageError('write_failed', 'Some saved results remain.');
      }
    },

    count: () => table.count(),
  };
}

/** In-memory table for tests and the developer playground. */
export class MemoryRecordTable implements RecordTable {
  readonly rows = new Map<string, StoredRow>();
  /** Set to make the next write throw, simulating an interrupted write. */
  failNextWrite: string | null = null;
  /** Set to make writes appear to succeed but not persist. */
  dropWrites = false;

  async put(row: StoredRow) {
    if (this.failNextWrite) {
      const message = this.failNextWrite;
      this.failNextWrite = null;
      throw new Error(message);
    }
    if (!this.dropWrites) {
      this.rows.set(row.id, { ...row });
    }
  }
  async get(id: string) {
    return this.rows.get(id) ?? null;
  }
  async listSummaries() {
    return [...this.rows.values()].map(
      ({ id, schemaVersion, savedAt, summary }) => ({
        id,
        schemaVersion,
        savedAt,
        summary,
      }),
    );
  }
  async remove(id: string) {
    if (this.failNextWrite) {
      const message = this.failNextWrite;
      this.failNextWrite = null;
      throw new Error(message);
    }
    this.rows.delete(id);
  }
  async clear() {
    if (this.failNextWrite) {
      const message = this.failNextWrite;
      this.failNextWrite = null;
      throw new Error(message);
    }
    this.rows.clear();
  }
  async count() {
    return this.rows.size;
  }
}
