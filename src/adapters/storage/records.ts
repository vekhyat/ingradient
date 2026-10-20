import type {
  Grade,
  LocalAssessment,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';
import { localValidators } from '../../domain/contracts/generated/validate-local';

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
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) &&
    Number.isFinite(Date.parse(value))
  );
}

export function assertRecordVersion(version: unknown): void {
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new StorageError('corrupt', 'Saved result has no valid version.');
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    throw new StorageError(
      'incompatible_schema',
      'Saved result uses an unsupported version of the app.',
    );
  }
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
  if (!isObject(parsed)) {
    throw new StorageError('corrupt', `Saved result ${id} has no version.`);
  }
  assertRecordVersion(parsed.schemaVersion);
  if (
    parsed.id !== id ||
    id.length === 0 ||
    parsed.kind !== 'product' ||
    !isTimestamp(parsed.savedAt) ||
    !(
      parsed.executor === 'phone' ||
      parsed.executor === 'backend' ||
      parsed.executor === null
    ) ||
    !(parsed.analysedAt === null || isTimestamp(parsed.analysedAt)) ||
    !localValidators.ProductSnapshot(parsed.snapshot) ||
    !localValidators.LocalAssessment(parsed.assessment)
  ) {
    throw new StorageError('corrupt', `Saved result ${id} is incomplete.`);
  }
  const record = parsed as unknown as SavedRecord;
  if (
    record.assessment.snapshotId !== record.snapshot.id ||
    record.assessment.scientific.inputSnapshotId !== record.snapshot.id
  ) {
    throw new StorageError(
      'corrupt',
      `Saved result ${id} has mismatched inputs.`,
    );
  }
  return record;
}

/** Validate list data before History reads names, dates and grade states. */
export function decodeSummary(id: string, body: string): SavedSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new StorageError('corrupt', `Saved result ${id} cannot be read.`);
  }
  if (
    !isObject(parsed) ||
    parsed.id !== id ||
    id.length === 0 ||
    parsed.kind !== 'product' ||
    !isTimestamp(parsed.savedAt) ||
    !(parsed.name === null || typeof parsed.name === 'string') ||
    ![
      'graded',
      'insufficient_data',
      'unsupported',
      'method_unavailable',
    ].includes(parsed.scienceState as string) ||
    (parsed.scienceState === 'graded'
      ? !['A', 'B', 'C', 'D', 'E'].includes(parsed.letter as string)
      : parsed.letter !== null)
  ) {
    throw new StorageError(
      'corrupt',
      `Saved result ${id} has an invalid summary.`,
    );
  }
  return parsed as unknown as SavedSummary;
}
