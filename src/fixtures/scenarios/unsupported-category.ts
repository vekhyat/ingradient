import type {
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
} from '../../domain/contracts/generated/local';
import type { LocalScenario } from './types';

const SNAPSHOT_ID = 'scenario-unsupported-category';
const CAPTURED_AT = '2026-10-16T00:00:00.000Z';

export function buildUnsupportedCategoryScenario(): LocalScenario {
  const snapshot: ProductSnapshot = {
    id: SNAPSHOT_ID,
    barcode: '8901030000003',
    name: 'Infant Formula Powder',
    market: 'IN',
    capturedAt: CAPTURED_AT,
    sourceRefs: [
      {
        id: 'src-0',
        kind: 'label',
        title: 'Combined label photo',
      },
    ],
    panels: [
      {
        panel: 'ingredients',
        state: 'read',
        imageId: 'img-3',
        regionId: 'reg-ing',
        text: 'Demineralised whey, skimmed milk, vegetable oils, minerals, vitamins',
        issues: [],
      },
    ],
    ingredients: [],
    observations: [],
    category: 'excluded',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  };

  const scientific: ScientificAssessment = {
    state: 'unsupported',
    inputSnapshotId: SNAPSHOT_ID,
    reasons: [],
    issues: [
      {
        code: 'category_excluded',
        stage: 'method',
        message:
          'Infant formulas and special medical purpose foods are excluded from Nutri-Score calculation.',
        action: 'none',
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
    name: 'unsupported_category',
    description:
      'Product with excluded category (infant nutrition) resulting in unsupported scientific assessment.',
    snapshot,
    assessment,
    lookupOutcome: {
      state: 'found',
      snapshot,
    },
  };
}
