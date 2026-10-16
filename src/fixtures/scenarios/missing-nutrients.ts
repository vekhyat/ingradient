import type {
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
} from '../../domain/contracts/generated/local';
import type { LocalScenario } from './types';

const SNAPSHOT_ID = 'scenario-missing-nutrients';
const CAPTURED_AT = '2026-10-16T00:00:00.000Z';

export function buildMissingNutrientsScenario(): LocalScenario {
  const snapshot: ProductSnapshot = {
    id: SNAPSHOT_ID,
    barcode: '8901030000002',
    name: 'Simple Cornflakes',
    market: 'IN',
    capturedAt: CAPTURED_AT,
    sourceRefs: [
      {
        id: 'src-0',
        kind: 'label',
        title: 'Nutrition panel',
      },
    ],
    panels: [
      {
        panel: 'nutrition',
        state: 'read',
        imageId: 'img-2',
        regionId: 'reg-nut',
        text: 'Energy 1500kJ, Sugars 8g, Saturated fat 0.5g, Sodium 0.4g',
        issues: [],
      },
    ],
    ingredients: [],
    observations: [
      {
        field: 'energy',
        kind: 'read',
        value: 1500,
        unit: 'kJ',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'sugars',
        kind: 'read',
        value: 8,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'saturated_fat',
        kind: 'read',
        value: 0.5,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'sodium',
        kind: 'read',
        value: 0.4,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'fibre',
        kind: 'missing',
        reason: 'not_declared',
        issues: [
          {
            code: 'missing_fibre',
            stage: 'completeness',
            field: 'fibre',
            message: 'Fibre is not declared on the package.',
            action: 'add_field',
          },
        ],
      },
    ],
    category: 'general',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  };

  const scientific: ScientificAssessment = {
    state: 'insufficient_data',
    inputSnapshotId: SNAPSHOT_ID,
    reasons: [],
    issues: [
      {
        code: 'missing_fibre',
        stage: 'completeness',
        field: 'fibre',
        message: 'Fibre is not available for this calculation.',
        action: 'add_field',
      },
    ],
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
    name: 'missing_nutrients',
    description:
      'Product with missing mandatory fibre observation leading to insufficient_data assessment.',
    snapshot,
    assessment,
    lookupOutcome: {
      state: 'found',
      snapshot,
    },
  };
}
