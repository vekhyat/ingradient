import type {
  Issue,
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
} from '../../domain/contracts/generated/local';
import type { LocalScenario } from './types';

const SNAPSHOT_ID = 'scenario-throttled-lookup';
const CAPTURED_AT = '2026-10-16T00:00:00.000Z';

const throttleIssue: Issue = {
  code: 'lookup_throttled',
  stage: 'lookup',
  message: 'Open Food Facts barcode lookup rate limited; retry after cooldown.',
  action: 'retry',
};

export function buildThrottledLookupScenario(): LocalScenario {
  const snapshot: ProductSnapshot = {
    id: SNAPSHOT_ID,
    barcode: '8901030000005',
    name: null,
    market: 'IN',
    capturedAt: CAPTURED_AT,
    sourceRefs: [],
    panels: [
      {
        panel: 'ingredients',
        state: 'missing',
        imageId: null,
        regionId: null,
        issues: [throttleIssue],
      },
      {
        panel: 'nutrition',
        state: 'missing',
        imageId: null,
        regionId: null,
        issues: [throttleIssue],
      },
    ],
    ingredients: [],
    observations: [],
    category: 'unknown',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  };

  const scientific: ScientificAssessment = {
    state: 'insufficient_data',
    inputSnapshotId: SNAPSHOT_ID,
    reasons: [],
    issues: [throttleIssue],
  };

  const assessment: LocalAssessment = {
    snapshotId: SNAPSHOT_ID,
    scientific,
    personal: {
      state: 'not_in_slice',
      issues: [],
    },
    citations: [],
  };

  return {
    name: 'throttled_lookup',
    description:
      'Barcode lookup throttled by Open Food Facts with a 60-second cooldown required before retry.',
    snapshot,
    assessment,
    lookupOutcome: {
      state: 'throttled',
      retryAfterSeconds: 60,
      issues: [throttleIssue],
    },
  };
}
