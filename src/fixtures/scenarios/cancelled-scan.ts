import type {
  Issue,
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
} from '../../domain/contracts/generated/local';
import type { LocalScenario } from './types';

const SNAPSHOT_ID = 'scenario-cancelled-scan';
const CAPTURED_AT = '2026-10-16T00:00:00.000Z';

const cancelIssue: Issue = {
  code: 'scan_cancelled',
  stage: 'capture',
  message: 'Scan was cancelled by the user before completion.',
  action: 'none',
};

export function buildCancelledScanScenario(): LocalScenario {
  const snapshot: ProductSnapshot = {
    id: SNAPSHOT_ID,
    barcode: null,
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
        issues: [cancelIssue],
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
    issues: [cancelIssue],
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
    name: 'cancelled_scan',
    description:
      'Scan operation cancelled by the user prior to completing image capture or lookup.',
    snapshot,
    assessment,
    lookupOutcome: {
      state: 'cancelled',
      issues: [cancelIssue],
    },
  };
}
