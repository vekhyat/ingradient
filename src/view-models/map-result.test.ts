import { describe, expect, it } from '@jest/globals';

import type { ProductSnapshot } from '../domain/contracts/generated/local';
import { getLocalScenario } from '../fixtures/scenarios';
import {
  dataCreditOf,
  opensResultAutomatically,
  toIngredientOccurrences,
  toLookupFailure,
  toNutrientViews,
  toResultView,
  toScientificView,
} from './map-result';

function resultFor(name: Parameters<typeof getLocalScenario>[0]) {
  const scenario = getLocalScenario(name);
  return toResultView({
    snapshot: scenario.snapshot,
    assessment: scenario.assessment,
    executor: 'phone',
    analysedAt: '2026-10-16T10:00:00.000Z',
  });
}

describe('toResultView', () => {
  it('maps a graded assessment to a supported letter with reasons', () => {
    const view = resultFor('complete_graded');
    expect(view.science).toMatchObject({ status: 'supported', letter: 'C' });
    expect(view.reasons.length).toBeGreaterThan(0);
    expect(view.summary).toBe(view.reasons[0]?.text);
    expect(view.personal).toEqual({ status: 'not_in_slice' });
    expect(view.method?.label).toBe('Nutrition grade · European reference');
  });

  it('keeps insufficient data as a named gap without a letter', () => {
    const view = resultFor('missing_nutrients');
    expect(view.science.status).toBe('insufficient_data');
    expect(view.summary).toBeNull();
    expect('letter' in view.science).toBe(false);
  });

  it('names the reason for an unsupported category', () => {
    const view = resultFor('unsupported_category');
    expect(view.science.status).toBe('unsupported');
    if (view.science.status === 'unsupported') {
      expect(view.science.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('nutrients', () => {
  it('shows a missing nutrient as unknown, never zero', () => {
    const view = resultFor('missing_nutrients');
    const missing = view.nutrients.find((row) => row.value === null);
    expect(missing).toBeDefined();
    expect(missing?.missingReason).toBeTruthy();
    expect(missing?.kind).toBeNull();
  });

  it('labels uncertain, corrected and estimated amounts in words', () => {
    const base = getLocalScenario('complete_graded').snapshot;
    const snapshot: ProductSnapshot = {
      ...base,
      sourceRefs: [
        ...base.sourceRefs,
        { id: 'src-fix', kind: 'user_correction', title: 'You corrected this' },
      ],
      observations: [
        {
          field: 'sugars',
          kind: 'uncertain',
          value: 12,
          unit: 'g',
          basis: 'per_100_g',
          sourceIds: ['src-0'],
          issues: [
            {
              code: 'blur',
              stage: 'extraction',
              message: 'The photo was blurry here.',
              action: 'edit',
            },
          ],
        },
        {
          field: 'salt',
          kind: 'corrected',
          value: 0.5,
          unit: 'g',
          basis: 'per_100_g',
          sourceIds: ['src-fix'],
          previousSourceIds: ['src-0'],
          issues: [],
        },
        {
          field: 'fvl',
          kind: 'estimated',
          value: 20,
          unit: 'percent',
          basis: 'per_100_g',
          sourceIds: ['src-0'],
          issues: [],
          modelId: 'model-x',
          modelVersion: '1',
        },
        {
          field: 'energy',
          kind: 'read',
          value: 1600,
          unit: 'kJ',
          basis: 'per_100_g',
          sourceIds: ['src-0'],
          issues: [],
        },
      ],
    };
    const rows = toNutrientViews(snapshot);
    // Energy sorts first in the fixed reading order.
    expect(rows.map((row) => row.field)).toEqual([
      'energy',
      'sugars',
      'salt',
      'fvl',
    ]);
    expect(rows[1]?.kind).toEqual({
      kind: 'uncertain',
      origin: 'ocr',
      cause: 'The photo was blurry here.',
    });
    expect(rows[2]?.kind).toEqual({
      kind: 'corrected',
      origin: 'user_correction',
      previous: 'ocr',
    });
    expect(rows[3]?.kind).toMatchObject({
      kind: 'estimated',
      modelId: 'model-x',
    });
    expect(rows[3]?.unit).toBe('%');
  });
});

describe('ingredients', () => {
  it('keeps pack order, nesting depth and duplicate occurrences', () => {
    const base = getLocalScenario('complete_graded').snapshot;
    const mention = (id: string, text: string, parentId: string | null) => ({
      id,
      text,
      parentId,
      canonicalId: null,
      state: 'unresolved' as const,
      candidateIds: [],
      sourceIds: ['src-0'] as [string],
      taxonomyVersion: 't',
    });
    const snapshot: ProductSnapshot = {
      ...base,
      ingredients: [
        mention('a', 'Chocolate', null),
        mention('b', 'sugar', 'a'),
        mention('c', 'sugar', null),
      ],
    };
    const rows = toIngredientOccurrences(snapshot);
    expect(
      rows.map((row) => [row.occurrenceId, row.packOrder, row.depth]),
    ).toEqual([
      ['a', 1, 0],
      ['b', 2, 1],
      ['c', 3, 0],
    ]);
    expect(rows[0]?.kind).toEqual({ kind: 'read', origin: 'ocr' });
  });
});

describe('credits', () => {
  it('distinguishes Open Food Facts, label photo and mixed sources', () => {
    const base = getLocalScenario('complete_graded').snapshot;
    expect(dataCreditOf(base)).toBe('label_photo');
    expect(
      dataCreditOf({
        ...base,
        sourceRefs: [
          { id: 'o', kind: 'off', title: 'Open Food Facts product' },
        ],
      }),
    ).toBe('off');
    expect(
      dataCreditOf({
        ...base,
        sourceRefs: [
          { id: 'o', kind: 'off', title: 'Open Food Facts product' },
          { id: 'l', kind: 'label', title: 'Label photo' },
        ],
      }),
    ).toBe('mixed');
  });
});

describe('U-AUTO-A gate', () => {
  it('opens Result for a grade or a gap no photo can fix', () => {
    const graded = getLocalScenario('complete_graded').assessment.scientific;
    const unsupported = getLocalScenario('unsupported_category').assessment
      .scientific;
    expect(opensResultAutomatically(toScientificView(graded))).toBe(true);
    expect(opensResultAutomatically(toScientificView(unsupported))).toBe(true);
    expect(
      opensResultAutomatically({ status: 'method_unavailable', gaps: ['x'] }),
    ).toBe(true);
  });

  it('stays on lookup for fillable missing data', () => {
    const missing = getLocalScenario('missing_nutrients').assessment.scientific;
    expect(opensResultAutomatically(toScientificView(missing))).toBe(false);
  });
});

describe('lookup failures', () => {
  it('keeps absent, offline and throttled distinct', () => {
    expect(toLookupFailure({ state: 'absent', issues: [] })).toEqual({
      status: 'absent',
    });
    expect(toLookupFailure({ state: 'offline', issues: [] })).toEqual({
      status: 'offline',
    });
    expect(
      toLookupFailure({
        state: 'throttled',
        issues: [],
        retryAfterSeconds: 30,
      }),
    ).toEqual({ status: 'throttled', retryAfterSeconds: 30 });
    expect(toLookupFailure({ state: 'invalid', issues: [] })).toEqual({
      status: 'invalid_code',
    });
  });
});
