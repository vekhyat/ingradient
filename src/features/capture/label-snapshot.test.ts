import { describe, expect, it } from '@jest/globals';

import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { localValidators } from '../../domain/contracts/generated/validate-local';
import { parseIngredients } from '../../domain/ingredients';
import { INGREDIENT_NESTING_LIMIT } from '../../domain/ingredients/limits';
import { labelFacts, labelFactsFromText } from '../../view-models/label-facts';
import { toNutrientViews } from '../../view-models/map-result';
import { createLabelSession } from './label-session';
import {
  buildLabelSnapshot,
  NO_CORRECTIONS,
  type Corrections,
} from './label-snapshot';

const capturedAt = '2026-10-20T08:00:00Z';
const text =
  'Ingredients: cereal (rice (52%), salt), emulsifier (E322), sugar (3%). Contains: milk, wheat. This product may contain traces of nuts and soy.';

function build(
  panelText: string,
  corrections: Corrections = NO_CORRECTIONS,
  base: ProductSnapshot | null = null,
) {
  const session = createLabelSession('review', null);
  if (!base)
    session.ingredients = { state: 'read', text: panelText, imageId: 'p1' };
  return buildLabelSnapshot({ session, base, capturedAt, corrections });
}

function catalogue(snapshot: ProductSnapshot): ProductSnapshot {
  const ids = new Map(
    snapshot.ingredients.map((m, index) => [m.id, `off-${index}`]),
  );
  return {
    ...snapshot,
    sourceRefs: [{ id: 'off-source', kind: 'off', title: 'Catalogue' }],
    ingredients: snapshot.ingredients.map((m) => ({
      ...m,
      id: ids.get(m.id)!,
      parentId: m.parentId ? ids.get(m.parentId)! : null,
      sourceIds: ['off-source'],
    })),
  };
}

describe('reviewed ingredient facts retain the original evidence', () => {
  it('corrects a parent name while retaining percentages, additive children and full allergen statements', () => {
    const before = build(text);
    const cereal = before.ingredients.find((m) => m.text === 'cereal')!;
    const snapshot = build(text, {
      ingredients: { [cereal.id]: { kind: 'text', text: 'wholegrain cereal' } },
      nutrients: {},
    });
    expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    expect(snapshot.panels[0]?.text).toBe(text);
    expect(snapshot.ingredients.find((m) => m.text === 'rice')?.parentId).toBe(
      cereal.id,
    );
    expect(labelFacts(snapshot)).toMatchObject({
      topLevel: ['wholegrain cereal', 'emulsifier', 'sugar'],
      percentages: [
        { name: 'rice', text: '52%' },
        { name: 'sugar', text: '3%' },
      ],
      additives: [{ code: '322', printedClass: 'emulsifier' }],
      contains: ['milk', 'wheat'],
      mayContain: ['nuts', 'soy'],
    });
  });

  it.each(['text', 'unreadable'] as const)(
    'updates a nested percentage ingredient marked %s',
    (kind) => {
      const rice = build(text).ingredients.find((m) => m.text === 'rice')!;
      const snapshot = build(text, {
        ingredients: {
          [rice.id]: kind === 'text' ? { kind, text: 'oats' } : { kind },
        },
        nutrients: {},
      });
      expect(snapshot.panels[0]?.text).toBe(text);
      expect(labelFacts(snapshot)?.percentages).toEqual(
        kind === 'text'
          ? [
              { name: 'oats', text: '52%' },
              { name: 'sugar', text: '3%' },
            ]
          : [{ name: 'sugar', text: '3%' }],
      );
      expect(labelFacts(snapshot)?.contains).toEqual(['milk', 'wheat']);
      expect(labelFacts(snapshot)?.mayContain).toEqual(['nuts', 'soy']);
    },
  );

  it('an unreadable parent takes precedence over a corrected child', () => {
    const before = build(text);
    const cereal = before.ingredients.find((m) => m.text === 'cereal')!;
    const rice = before.ingredients.find((m) => m.text === 'rice')!;
    const snapshot = build(text, {
      ingredients: {
        [cereal.id]: { kind: 'unreadable' },
        [rice.id]: { kind: 'text', text: 'oats' },
      },
      nutrients: {},
    });
    expect(labelFacts(snapshot)?.topLevel).toEqual(['emulsifier', 'sugar']);
    expect(labelFacts(snapshot)?.percentages).toEqual([
      { name: 'sugar', text: '3%' },
    ]);
  });

  it('maps a unique catalogue correction to its original nested span', () => {
    const base = catalogue(build(text));
    const rice = base.ingredients.find((m) => m.text === 'rice')!;
    const corrected = build(
      text,
      {
        ingredients: { [rice.id]: { kind: 'text', text: 'oats' } },
        nutrients: {},
      },
      base,
    );
    expect(labelFacts(corrected)?.percentages[0]).toEqual({
      name: 'oats',
      text: '52%',
    });
    expect(corrected.panels[0]?.text).toBe(text);
    // A later correction can still locate the original span after the name changed.
    const second = build(
      text,
      {
        ingredients: { [rice.id]: { kind: 'text', text: 'barley' } },
        nutrients: {},
      },
      corrected,
    );
    expect(labelFacts(second)?.percentages[0]).toEqual({
      name: 'barley',
      text: '52%',
    });
  });

  it('edits only the selected duplicate photo mention and leaves ambiguous catalogue spans untouched', () => {
    const duplicated =
      'Ingredients: rice (20%), cereal (rice (30%)), salt. Contains: milk.';
    const photo = build(duplicated);
    const rice = photo.ingredients.filter((m) => m.text === 'rice')[1]!;
    const corrected = build(duplicated, {
      ingredients: { [rice.id]: { kind: 'text', text: 'oats' } },
      nutrients: {},
    });
    expect(labelFacts(corrected)?.percentages).toEqual([
      { name: 'rice', text: '20%' },
      { name: 'oats', text: '30%' },
    ]);
    const base = catalogue(photo);
    const offRice = base.ingredients.filter((m) => m.text === 'rice')[1]!;
    const ambiguous = build(
      duplicated,
      {
        ingredients: { [offRice.id]: { kind: 'text', text: 'oats' } },
        nutrients: {},
      },
      base,
    );
    expect(ambiguous.ingredients.find((m) => m.id === offRice.id)?.text).toBe(
      'oats',
    );
    expect(labelFacts(ambiguous)).toEqual(labelFactsFromText(duplicated));
  });

  it.each(['text', 'unreadable'] as const)(
    'does not overlay an opaque nesting-limit span marked %s',
    (kind) => {
      const groups = INGREDIENT_NESTING_LIMIT - 1;
      const deep = `Ingredients: Sauce {${'['.repeat(groups)}salt${']'.repeat(groups)}}. Contains: milk.`;
      const opaque = parseIngredients(deep).mentions.find((m) =>
        m.issues.some((issue) => issue.code === 'nesting_limit'),
      )!;
      expect(opaque).toBeDefined();
      const corrected = build(deep, {
        ingredients: {
          [opaque.id]: kind === 'text' ? { kind, text: 'oats' } : { kind },
        },
        nutrients: {},
      });
      expect(labelFacts(corrected)).toEqual(labelFactsFromText(deep));
      expect(corrected.panels[0]?.text).toBe(deep);
    },
  );

  it('rejects ingredient corrections outside the frozen contract limit', () => {
    const rice = build(text).ingredients.find((m) => m.text === 'rice')!;
    expect(() =>
      build(text, {
        ingredients: { [rice.id]: { kind: 'text', text: 'x'.repeat(2001) } },
        nutrients: {},
      }),
    ).toThrow(RangeError);
  });
});

describe('nutrient review uses stable original observation rows', () => {
  const base: ProductSnapshot = {
    ...build('Ingredients: rice.'),
    observations: [
      {
        field: 'protein',
        kind: 'read',
        value: 7,
        unit: 'g',
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
        field: 'sugars',
        kind: 'read',
        value: 3,
        unit: 'g',
        basis: 'per_serving',
        sourceIds: ['src-0'],
        issues: [],
      },
    ],
  };
  const corrected = (nutrients: Corrections['nutrients'], original = base) =>
    build('', { ingredients: {}, nutrients }, original);

  it('retains row ids through display sorting, value/basis changes and unreadable replacement', () => {
    expect(toNutrientViews(base).map((row) => [row.field, row.rowId])).toEqual([
      ['sugars', '1'],
      ['sugars', '2'],
      ['protein', '0'],
    ]);
    const snapshot = corrected({
      'sugars:1': {
        kind: 'value',
        value: 15,
        unit: 'percent',
        basis: 'per_100_ml',
      },
      'sugars:2': { kind: 'unreadable' },
    });
    expect(snapshot.observations.slice(0, 3)).toMatchObject([
      base.observations[0]!,
      {
        field: 'sugars',
        kind: 'corrected',
        value: 15,
        unit: 'percent',
        basis: 'per_100_ml',
      },
      { field: 'sugars', kind: 'missing', reason: 'unreadable' },
    ]);
    expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    expect(
      toNutrientViews(snapshot)
        .filter((row) => row.field === 'sugars')
        .map((row) => row.rowId),
    ).toEqual(['1', '2']);
  });

  it('legacy field corrections target only a unique row or a unique matching basis', () => {
    expect(
      corrected({ sugars: { kind: 'unreadable' } }).observations.slice(0, 3),
    ).toEqual(base.observations);
    const snapshot = corrected({
      sugars: { kind: 'value', value: 5, unit: 'g', basis: 'per_serving' },
    });
    expect(snapshot.observations[1]).toEqual(base.observations[1]);
    expect(snapshot.observations[2]).toMatchObject({
      kind: 'corrected',
      value: 5,
    });
    const sameBasis: ProductSnapshot = {
      ...base,
      observations: base.observations.map((o) =>
        o.kind === 'missing' ? o : { ...o, basis: 'per_100_g' },
      ),
    };
    expect(
      corrected(
        { sugars: { kind: 'value', value: 5, unit: 'g', basis: 'per_100_g' } },
        sameBasis,
      ).observations.slice(0, 3),
    ).toEqual(sameBasis.observations);
    expect(
      corrected({ protein: { kind: 'unreadable' } }).observations[0],
    ).toMatchObject({ kind: 'missing', reason: 'unreadable' });
  });
});
