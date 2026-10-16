import type {
  Grade,
  LocalAssessment,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';

/**
 * Saved-result record format. Every record carries `schemaVersion`, so a
 * later app version can migrate old records instead of misreading them.
 */
export const CURRENT_SCHEMA_VERSION = 1;

export interface SavedRecordV1 {
  schemaVersion: 1;
  id: string;
  savedAt: string;
  kind: 'product';
  snapshot: ProductSnapshot;
  assessment: LocalAssessment;
  executor: 'phone' | 'backend' | null;
  analysedAt: string | null;
}

export type SavedRecord = SavedRecordV1;

/** The small part History needs, stored beside the body so lists stay fast. */
export interface SavedSummary {
  id: string;
  savedAt: string;
  kind: 'product';
  name: string | null;
  letter: Grade | null;
  scienceState: LocalAssessment['scientific']['state'];
}

export type StorageErrorCode =
  | 'unavailable'
  | 'key_lost'
  | 'corrupt'
  | 'incompatible_schema'
  | 'write_failed'
  | 'not_found';

export class StorageError extends Error {
  override readonly name = 'StorageError';
  constructor(
    readonly code: StorageErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export function summarise(record: SavedRecord): SavedSummary {
  const scientific = record.assessment.scientific;
  return {
    id: record.id,
    savedAt: record.savedAt,
    kind: record.kind,
    name: record.snapshot.name,
    letter: scientific.state === 'graded' ? scientific.grade : null,
    scienceState: scientific.state,
  };
}

export function encodeRecord(record: SavedRecord): string {
  return JSON.stringify(record);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Reads a stored body. Unknown future versions are refused, not guessed at;
 * unreadable text is reported as corrupt and is never silently dropped.
 */
export function decodeRecord(id: string, body: string): SavedRecord {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new StorageError('corrupt', `Saved result ${id} cannot be read.`);
  }
  if (!isObject(parsed) || typeof parsed.schemaVersion !== 'number') {
    throw new StorageError('corrupt', `Saved result ${id} has no version.`);
  }
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new StorageError(
      'incompatible_schema',
      `Saved result ${id} was written by a newer version of the app.`,
    );
  }
  const record = migrate(parsed);
  if (
    record.id !== id ||
    !isObject(record.snapshot) ||
    !isObject(record.assessment)
  ) {
    throw new StorageError('corrupt', `Saved result ${id} is incomplete.`);
  }
  return record;
}

/** Version 1 is the first format; later versions add steps here. */
function migrate(parsed: Record<string, unknown>): SavedRecord {
  return parsed as unknown as SavedRecordV1;
}
