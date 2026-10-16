import type {
  Citation,
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
} from '../../domain/contracts/generated/local';
import type { LocalScenario } from './types';

const SNAPSHOT_ID = 'scenario-complete-graded';
const CAPTURED_AT = '2026-10-16T00:00:00.000Z';
const CHECKED_AT_DATE = '2026-10-16';
const METHOD_LABEL = 'Nutrition grade · European reference' as const;
const ZERO_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';

const citation: Citation = {
  id: 'spf-faq-v11',
  title: 'Nutri-Score FAQ (Version 11)',
  issuer: 'Santé publique France',
  url: 'https://www.santepubliquefrance.fr',
  edition: 'faq-v11-2025-03-17',
  locator: 'Section 4',
  claimScope: 'general',
  checkedAt: CHECKED_AT_DATE,
};

export function buildCompleteGradedScenario(): LocalScenario {
  const snapshot: ProductSnapshot = {
    id: SNAPSHOT_ID,
    barcode: '8901030000001',
    name: 'Oat Crunch Cereal',
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
        imageId: 'img-1',
        regionId: 'reg-ing',
        text: 'Whole grain oats, sugar, sunflower oil, sea salt',
        issues: [],
      },
      {
        panel: 'nutrition',
        state: 'read',
        imageId: 'img-1',
        regionId: 'reg-nut',
        text: 'Energy 1600kJ, Sugars 12g, Saturated fat 1.5g, Sodium 0.2g, Fibre 8g, Protein 9g',
        issues: [],
      },
    ],
    ingredients: [
      {
        id: 'ing-1',
        text: 'Whole grain oats',
        parentId: null,
        canonicalId: 'oats',
        state: 'matched',
        candidateIds: ['oats'],
        sourceIds: ['src-0'],
        taxonomyVersion: 'fictional-taxonomy',
      },
      {
        id: 'ing-2',
        text: 'sugar',
        parentId: null,
        canonicalId: 'sugar',
        state: 'matched',
        candidateIds: ['sugar'],
        sourceIds: ['src-0'],
        taxonomyVersion: 'fictional-taxonomy',
      },
      {
        id: 'ing-3',
        text: 'sunflower oil',
        parentId: null,
        canonicalId: 'sunflower_oil',
        state: 'matched',
        candidateIds: ['sunflower_oil'],
        sourceIds: ['src-0'],
        taxonomyVersion: 'fictional-taxonomy',
      },
      {
        id: 'ing-4',
        text: 'sea salt',
        parentId: null,
        canonicalId: 'salt',
        state: 'matched',
        candidateIds: ['salt'],
        sourceIds: ['src-0'],
        taxonomyVersion: 'fictional-taxonomy',
      },
    ],
    observations: [
      {
        field: 'energy',
        kind: 'read',
        value: 1600,
        unit: 'kJ',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'sugars',
        kind: 'read',
        value: 12,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'saturated_fat',
        kind: 'read',
        value: 1.5,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'sodium',
        kind: 'read',
        value: 0.2,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'fibre',
        kind: 'read',
        value: 8,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
      {
        field: 'protein',
        kind: 'read',
        value: 9,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
    ],
    category: 'general',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  };

  const scientific: ScientificAssessment = {
    state: 'graded',
    grade: 'C',
    score: 5,
    route: 'general',
    method: {
      id: 'nutriscore-updated-2023',
      edition: 'faq-v11-2025-03-17',
      bundleId: 'fixture-method-1',
      bundleSha256: ZERO_HASH,
      label: METHOD_LABEL,
    },
    inputSnapshotId: SNAPSHOT_ID,
    reasons: [
      {
        id: 'reason-sugars',
        templateId: 'fixture.reason',
        text: 'Moderate sugar contribution to energy density.',
        citationIds: ['spf-faq-v11'],
        inputFields: ['sugars'],
        step: 'sugars-points',
      },
    ],
    trace: [
      {
        component: 'sugars',
        inputFields: ['sugars'],
        points: 3,
        ruleLocator: 'Table 1: Nutri-Score General Food Rules',
        citationIds: ['spf-faq-v11'],
      },
    ],
    issues: [],
  };

  const assessment: LocalAssessment = {
    snapshotId: SNAPSHOT_ID,
    scientific,
    personal: {
      state: 'not_in_slice',
      issues: [],
    },
    citations: [citation],
  };

  return {
    name: 'complete_graded',
    description:
      'Complete product with fully read label panels and a valid graded Nutri-Score assessment.',
    snapshot,
    assessment,
    lookupOutcome: {
      state: 'found',
      snapshot,
    },
  };
}
