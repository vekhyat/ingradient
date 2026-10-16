import { getRandomBytesAsync } from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import * as SecureStore from 'expo-secure-store';
import {
  defaultDatabaseDirectory,
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteDatabase,
} from 'expo-sqlite';

import { resolveDatabaseKey, type KeyVault } from './database-key';
import { StorageError } from './records';
import type { RecordTable, StoredRow } from './snapshot-store';

const DATABASE_NAME = 'ingradient-saved.db';
const KEY_NAME = 'ingradient.saved-db.key.v1';

/**
 * Keystore-backed vault. WHEN_UNLOCKED_THIS_DEVICE_ONLY keeps the key off
 * other devices; android:allowBackup=false (app.json) keeps the database
 * out of Android backups.
 */
export const secureStoreVault: KeyVault = {
  read: () =>
    SecureStore.getItemAsync(KEY_NAME, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  write: (value) =>
    SecureStore.setItemAsync(KEY_NAME, value, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }),
  remove: () => SecureStore.deleteItemAsync(KEY_NAME),
};

async function randomKeyHex(): Promise<string> {
  const bytes = await getRandomBytesAsync(32);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}

function databaseFileExists(): boolean {
  try {
    const directory = String(defaultDatabaseDirectory ?? '');
    const file = directory
      ? new File(directory, DATABASE_NAME)
      : new File(Paths.document, 'SQLite', DATABASE_NAME);
    return file.exists;
  } catch {
    return false;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS saved_results (
  id TEXT PRIMARY KEY NOT NULL,
  schema_version INTEGER NOT NULL,
  saved_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT NOT NULL
);`;

/**
 * Opens the SQLCipher database with the keystore key. A wrong or missing key
 * surfaces as `key_lost`; nothing is deleted automatically.
 */
export async function openEncryptedDatabase(): Promise<SQLiteDatabase> {
  const { key } = await resolveDatabaseKey(
    secureStoreVault,
    databaseFileExists(),
    randomKeyHex,
  );
  let db: SQLiteDatabase;
  try {
    db = await openDatabaseAsync(DATABASE_NAME);
  } catch (error) {
    throw new StorageError(
      'unavailable',
      `Could not open saved results: ${(error as Error).message}`,
    );
  }
  try {
    // Raw 256-bit key, so SQLCipher skips its passphrase derivation.
    await db.execAsync(`PRAGMA key = "x'${key}'";`);
    await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master;');
  } catch {
    await db.closeAsync().catch(() => undefined);
    throw new StorageError(
      'key_lost',
      'Saved results could not be decrypted with this phone’s key.',
    );
  }
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(SCHEMA);
  return db;
}

/**
 * Deletes the database file and its key. Used only after the user confirms
 * "Erase saved results" while the data cannot be opened.
 */
export async function destroyEncryptedDatabase(): Promise<void> {
  await deleteDatabaseAsync(DATABASE_NAME).catch(() => undefined);
  await secureStoreVault.remove();
}

export function sqlRecordTable(db: SQLiteDatabase): RecordTable {
  return {
    async put(row: StoredRow) {
      // Same connection on purpose: withExclusiveTransactionAsync opens a
      // second connection that has not been given the SQLCipher key.
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT OR REPLACE INTO saved_results (id, schema_version, saved_at, summary, body)
           VALUES (?, ?, ?, ?, ?);`,
          [row.id, row.schemaVersion, row.savedAt, row.summary, row.body],
        );
      });
    },
    async get(id) {
      const row = await db.getFirstAsync<{
        id: string;
        schema_version: number;
        saved_at: string;
        summary: string;
        body: string;
      }>('SELECT * FROM saved_results WHERE id = ?;', [id]);
      return row
        ? {
            id: row.id,
            schemaVersion: row.schema_version,
            savedAt: row.saved_at,
            summary: row.summary,
            body: row.body,
          }
        : null;
    },
    async listSummaries() {
      return db.getAllAsync<{ id: string; summary: string }>(
        'SELECT id, summary FROM saved_results ORDER BY saved_at DESC;',
      );
    },
    async remove(id) {
      await db.runAsync('DELETE FROM saved_results WHERE id = ?;', [id]);
    },
    async clear() {
      await db.withTransactionAsync(async () => {
        await db.runAsync('DELETE FROM saved_results;');
      });
    },
    async count() {
      const row = await db.getFirstAsync<{ n: number }>(
        'SELECT count(*) AS n FROM saved_results;',
      );
      return row?.n ?? 0;
    },
  };
}
