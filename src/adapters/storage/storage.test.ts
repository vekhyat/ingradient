import { describe, expect, it } from '@jest/globals';

import { getLocalScenario } from '../../fixtures/scenarios';
import { resolveDatabaseKey, type KeyVault } from './database-key';
import {
  StorageError,
  decodeRecord,
  encodeRecord,
  type SavedRecord,
} from './records';
import { MemoryRecordTable, createSnapshotStore } from './snapshot-store';

function record(id: string, savedAt: string): SavedRecord {
  const scenario = getLocalScenario('complete_graded');
  return {
    schemaVersion: 1,
    id,
    savedAt,
    kind: 'product',
    snapshot: scenario.snapshot,
    assessment: scenario.assessment,
    executor: 'phone',
    analysedAt: savedAt,
  };
}

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as StorageError).code;
  }
  return 'resolved';
}

describe('snapshot store', () => {
  it('acknowledges a save only after it reads the row back', async () => {
    const table = new MemoryRecordTable();
    const store = createSnapshotStore(table);
    const summary = await store.save(record('r1', '2026-10-16T10:00:00Z'));
    expect(summary).toMatchObject({ id: 'r1', letter: 'C', kind: 'product' });
    expect((await store.get('r1')).snapshot.name).toBe('Oat Crunch Cereal');
  });

  it('reports an interrupted write and stores nothing', async () => {
    const table = new MemoryRecordTable();
    table.failNextWrite = 'disk full';
    const store = createSnapshotStore(table);
    expect(
      await rejectionCode(store.save(record('r1', '2026-10-16T10:00Z'))),
    ).toBe('write_failed');
    expect(await store.count()).toBe(0);
  });

  it('does not acknowledge a write that silently did not persist', async () => {
    const table = new MemoryRecordTable();
    table.dropWrites = true;
    const store = createSnapshotStore(table);
    expect(
      await rejectionCode(store.save(record('r1', '2026-10-16T10:00Z'))),
    ).toBe('write_failed');
  });

  it('lists newest first', async () => {
    const store = createSnapshotStore(new MemoryRecordTable());
    await store.save(record('old', '2026-10-01T10:00:00Z'));
    await store.save(record('new', '2026-10-16T10:00:00Z'));
    expect((await store.list()).map((row) => row.id)).toEqual(['new', 'old']);
  });

  it('confirms delete and erase', async () => {
    const table = new MemoryRecordTable();
    const store = createSnapshotStore(table);
    await store.save(record('a', '2026-10-16T10:00:00Z'));
    await store.save(record('b', '2026-10-16T11:00:00Z'));
    await store.remove('a');
    expect(await rejectionCode(store.get('a'))).toBe('not_found');
    table.failNextWrite = 'locked';
    expect(await rejectionCode(store.eraseAll())).toBe('write_failed');
    expect(await store.count()).toBe(1);
    await store.eraseAll();
    expect(await store.count()).toBe(0);
  });

  it('reports a corrupt row as an error instead of hiding it', async () => {
    const table = new MemoryRecordTable();
    const store = createSnapshotStore(table);
    await store.save(record('r1', '2026-10-16T10:00:00Z'));
    const row = table.rows.get('r1');
    if (row) {
      table.rows.set('r1', { ...row, body: '{not json' });
    }
    expect(await rejectionCode(store.get('r1'))).toBe('corrupt');
    // The corrupt row is still there for the user to decide about.
    expect(await store.count()).toBe(1);
  });
});

describe('record versions', () => {
  it('round-trips the current version', () => {
    const original = record('r1', '2026-10-16T10:00:00Z');
    expect(decodeRecord('r1', encodeRecord(original))).toEqual(original);
  });

  it('refuses a record from a newer app version', () => {
    const future = {
      ...record('r1', '2026-10-16T10:00:00Z'),
      schemaVersion: 9,
    };
    expect(() => decodeRecord('r1', JSON.stringify(future))).toThrow(
      expect.objectContaining({ code: 'incompatible_schema' }),
    );
  });

  it('refuses a body whose id does not match its row', () => {
    const body = encodeRecord(record('r1', '2026-10-16T10:00:00Z'));
    expect(() => decodeRecord('other', body)).toThrow(
      expect.objectContaining({ code: 'corrupt' }),
    );
  });
});

function memoryVault(initial: string | null = null): KeyVault & {
  value: string | null;
} {
  const vault = {
    value: initial,
    async read() {
      return vault.value;
    },
    async write(next: string) {
      vault.value = next;
    },
    async remove() {
      vault.value = null;
    },
  };
  return vault;
}

const KEY = 'a'.repeat(64);

describe('database key', () => {
  it('creates and stores a key on a fresh install', async () => {
    const vault = memoryVault();
    const decision = await resolveDatabaseKey(vault, false, async () => KEY);
    expect(decision).toEqual({ key: KEY, created: true });
    expect(vault.value).toBe(KEY);
  });

  it('reuses the existing key', async () => {
    const vault = memoryVault(KEY);
    const decision = await resolveDatabaseKey(vault, true, async () =>
      'b'.repeat(64),
    );
    expect(decision).toEqual({ key: KEY, created: false });
  });

  it('reports key loss without creating a new key over existing data', async () => {
    const vault = memoryVault();
    expect(
      await rejectionCode(resolveDatabaseKey(vault, true, async () => KEY)),
    ).toBe('key_lost');
    expect(vault.value).toBeNull();
  });

  it('reports an unavailable keystore', async () => {
    const vault: KeyVault = {
      read: () => Promise.reject(new Error('keystore locked')),
      write: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    };
    expect(
      await rejectionCode(resolveDatabaseKey(vault, false, async () => KEY)),
    ).toBe('unavailable');
  });
});
