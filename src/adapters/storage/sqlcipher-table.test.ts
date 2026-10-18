import { describe, expect, it, jest } from '@jest/globals';
import type { SQLiteDatabase } from 'expo-sqlite';

import * as SecureStore from 'expo-secure-store';
import { deleteDatabaseAsync } from 'expo-sqlite';

import { StorageError } from './records';
import { destroyEncryptedDatabase, sqlRecordTable } from './sqlcipher-table';

// Whether the database file is still on disk after a delete attempt.
let mockFileRemains = false;
jest.mock('expo-crypto', () => ({ getRandomBytesAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation(() => ({
    get exists() {
      return mockFileRemains;
    },
  })),
  Paths: { document: 'file:///documents' },
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-sqlite', () => ({
  defaultDatabaseDirectory: '',
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
  it('removes the key only after the file is gone', async () => {
    mockFileRemains = false;
    jest.mocked(SecureStore.deleteItemAsync).mockClear();
    await destroyEncryptedDatabase();
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
});
