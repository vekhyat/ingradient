import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite';
import { File } from 'expo-file-system';

import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseAsync } from 'expo-sqlite';

import { StorageError } from './records';
import { destroyEncryptedDatabase, sqlRecordTable } from './sqlcipher-table';

// Whether the database file is still on disk after a delete attempt.
let mockFileRemains = false;
let mockDatabaseDirectory = '';
const mockFiles = new Set<string>();
const mockBlockedFiles = new Set<string>();
const mockDeletedFiles: string[] = [];
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((...parts: unknown[]) => {
    if (String(parts[0]).startsWith('/'))
      throw new Error('File requires an absolute URI');
    const name = String(parts.at(-1) ?? '');
    return {
      get exists() {
        return mockFileRemains || mockFiles.has(name);
      },
      delete() {
        mockDeletedFiles.push(name);
        if (mockBlockedFiles.has(name)) throw new Error('File is locked');
        mockFiles.delete(name);
      },
    };
  }),
  Paths: { document: 'file:///documents' },
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-sqlite', () => ({
  get defaultDatabaseDirectory() {
    return mockDatabaseDirectory;
  },
  deleteDatabaseAsync: jest.fn(async () => undefined),
  openDatabaseAsync: jest.fn(),
}));

function recordingDatabase() {
  const statements: string[] = [];
  const db = {
    runAsync: async (sql: string) => {
      statements.push(sql);
    },
    execAsync: async (sql: string) => {
      statements.push(sql);
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      statements.push('BEGIN');
      await task();
      statements.push('COMMIT');
    },
  };
  return { db: db as unknown as SQLiteDatabase, statements };
}

describe('sqlRecordTable erase (NAT-01 finding 4)', () => {
  it('compacts the file after Erase, outside the transaction', async () => {
    const { db, statements } = recordingDatabase();
    await sqlRecordTable(db).clear();
    expect(statements).toEqual([
      'BEGIN',
      'DELETE FROM saved_results;',
      'COMMIT',
      'PRAGMA wal_checkpoint(TRUNCATE);',
      'VACUUM;',
      'PRAGMA wal_checkpoint(TRUNCATE);',
    ]);
  });

  it('checkpoints the log after deleting one result', async () => {
    const { db, statements } = recordingDatabase();
    await sqlRecordTable(db).remove('result-1');
    expect(statements).toEqual([
      'DELETE FROM saved_results WHERE id = ?;',
      'PRAGMA wal_checkpoint(TRUNCATE);',
    ]);
  });
});

describe('destroyEncryptedDatabase (NAT-01 finding 4)', () => {
  beforeEach(() => {
    mockFileRemains = false;
    mockDatabaseDirectory = '';
    mockFiles.clear();
    mockBlockedFiles.clear();
    mockDeletedFiles.length = 0;
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
  });

  it('removes the key only after the file is gone', async () => {
    mockFileRemains = false;
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    await destroyEncryptedDatabase();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      '/data/user/0/example/files/SQLite',
      'file:///data/user/0/example/files/SQLite',
    ],
    ['file:///documents/SQLite', 'file:///documents/SQLite'],
  ])('uses a file URI for SQLite directory %s', async (directory, uri) => {
    mockDatabaseDirectory = directory;
    jest.mocked(File).mockClear();
    await destroyEncryptedDatabase();
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      expect(File).toHaveBeenCalledWith(uri, `ingradient-saved.db${suffix}`);
    }
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it('reports a file that survives the delete and keeps the key', async () => {
    mockFileRemains = true;
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    jest
      .mocked(deleteDatabaseAsync)
      .mockRejectedValueOnce(new Error('database is currently open'));
    const erase = destroyEncryptedDatabase();
    await expect(erase).rejects.toBeInstanceOf(StorageError);
    await expect(destroyEncryptedDatabase()).rejects.toThrow(
      /could not be erased/,
    );
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    mockFileRemains = false;
  });

  it('removes orphaned WAL, shared-memory and rollback-journal files before the key', async () => {
    const sidecars = ['-wal', '-shm', '-journal'].map(
      (suffix) => `ingradient-saved.db${suffix}`,
    );
    for (const name of sidecars) mockFiles.add(name);
    jest
      .mocked(deleteDatabaseAsync)
      .mockRejectedValueOnce(new Error('Main database is already absent'));
    jest
      .mocked(SecureStore.deleteItemAsync)
      .mockImplementationOnce(async () => {
        expect(mockFiles.size).toBe(0);
      });
    await destroyEncryptedDatabase();
    expect(mockDeletedFiles).toEqual(sidecars);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
  });

  it.each(['-wal', '-shm', '-journal'])(
    'keeps the key while a %s sidecar cannot be erased, then permits retry',
    async (suffix) => {
      const name = `ingradient-saved.db${suffix}`;
      mockFiles.add(name);
      mockBlockedFiles.add(name);
      await expect(destroyEncryptedDatabase()).rejects.toMatchObject({
        code: 'write_failed',
      });
      expect(mockFiles.has(name)).toBe(true);
      expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
      mockBlockedFiles.delete(name);
      await destroyEncryptedDatabase();
      expect(mockFiles.size).toBe(0);
      expect(SecureStore.deleteItemAsync).toHaveBeenCalledTimes(1);
    },
  );
});
