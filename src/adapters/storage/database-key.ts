import { StorageError } from './records';

/**
 * The database key lives in the platform keystore (Android Keystore through
 * expo-secure-store), never in the database file or in JavaScript storage.
 */
export interface KeyVault {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  remove(): Promise<void>;
}

export interface KeyDecision {
  key: string;
  created: boolean;
}

/**
 * Returns the existing key, or creates one for a fresh install.
 *
 * If the database file already exists but the key is gone (restored backup,
 * cleared keystore), the data cannot be decrypted. That is reported as
 * `key_lost`; the file is not deleted here, because erasing is the user's
 * explicit choice.
 */
export async function resolveDatabaseKey(
  vault: KeyVault,
  databaseExists: boolean,
  randomHex: () => Promise<string>,
): Promise<KeyDecision> {
  let existing: string | null;
  try {
    existing = await vault.read();
  } catch {
    throw new StorageError(
      'unavailable',
      'The secure key store on this phone is not available.',
    );
  }
  if (existing !== null && /^[0-9a-f]{64}$/.test(existing)) {
    return { key: existing, created: false };
  }
  if (databaseExists) {
    throw new StorageError(
      'key_lost',
      'Saved results are on this phone but their key is missing, so they cannot be opened.',
    );
  }
  const key = await randomHex();
  if (!/^[0-9a-f]{64}$/.test(key)) {
    throw new StorageError('unavailable', 'Could not create a database key.');
  }
  await vault.write(key);
  const confirm = await vault.read();
  if (confirm !== key) {
    throw new StorageError('unavailable', 'Could not store the database key.');
  }
  return { key, created: true };
}
