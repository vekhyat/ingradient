import { Directory, File, Paths } from 'expo-file-system';

/**
 * Label photos live only in this cache folder while the user checks them.
 * They are deleted on success, on cancel, and at every app start, and are
 * never uploaded (D67). No recovery copy is kept.
 */
const FOLDER = 'ingradient-session-photos';

function folder(): Directory {
  return new Directory(Paths.cache, FOLDER);
}

/** Moves a freshly taken photo into the session folder and returns its URI. */
export async function adoptSessionPhoto(uri: string): Promise<string> {
  const dir = folder();
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  const source = new File(uri);
  const target = new File(dir, `${Date.now()}-${source.name}`);
  await source.move(target);
  return target.uri;
}

/** Deletes one session photo; missing files are ignored. */
export function deleteSessionPhoto(uri: string): void {
  try {
    const file = new File(uri);
    if (file.exists) {
      file.delete();
    }
  } catch {
    // Already gone.
  }
}

/** Deletes every session photo. Returns how many files were removed. */
export function clearSessionPhotos(): number {
  try {
    const dir = folder();
    if (!dir.exists) {
      return 0;
    }
    const count = dir.list().length;
    dir.delete();
    return count;
  } catch {
    return 0;
  }
}
