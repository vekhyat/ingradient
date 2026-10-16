import type {
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
} from '../../domain/contracts/generated/local';
import type { LocalScenario } from './types';

const SNAPSHOT_ID = 'scenario-conflicting-sources';
const CAPTURED_AT = '2026-10-16T00:00:00.000Z';

export function buildConflictingSourcesScenario(): LocalScenario {
  const snapshot: ProductSnapshot = {
    id: SNAPSHOT_ID,
    barcode: '8901030000004',
    name: 'Almond Milk Drink',
    market: 'IN',
    capturedAt: CAPTURED_AT,
    sourceRefs: [
      {
        id: 'src-0',
        kind: 'label',
        title: 'Nutrition panel',
      },
      {
        id: 'src-1',
        kind: 'off',
        title: 'Open Food Facts product',
        edition: 'rev-42',
      },
    ],
    panels: [
      {
        panel: 'nutrition',
        state: 'read',
        imageId: 'img-4',
        regionId: 'reg-nut',
        text: 'Sugars 15g per 100ml',
        issues: [],
      },
    ],
    ingredients: [],
    observations: [
      {
        field: 'energy',
        kind: 'read',
        value: 180,
        unit: 'kJ',
        basis: 'per_100_ml',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'sugars',
        kind: 'missing',
        reason: 'conflicting_sources',
        issues: [
          {
            code: 'conflicting_nutrient_sources',
            stage: 'extraction',
            field: 'sugars',
            message:
              'Label OCR reports sugars 15g whereas Open Food Facts reports 2g.',
            action: 'edit',
          },
        ],
      },
    ],
    category: 'beverage',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  };

  const scientific: ScientificAssessment = {
    state: 'insufficient_data',
    inputSnapshotId: SNAPSHOT_ID,
    reasons: [],
    issues: [
      {
        code: 'conflicting_nutrient_sources',
        stage: 'completeness',
        field: 'sugars',
        message:
          'Conflicting values between label OCR and Open Food Facts prevent scoring.',
        action: 'edit',
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
    name: 'conflicting_sources',
    description:
      'Product with conflicting observations between label OCR and Open Food Facts.',
    snapshot,
    assessment,
    lookupOutcome: {
      state: 'found',
      snapshot,
    },
  };
}
