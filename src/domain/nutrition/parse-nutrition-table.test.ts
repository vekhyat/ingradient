/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import { validateAnalyzeRequest } from '../contracts/generated/validate-wire';
import { validationDetail } from '../contracts/validator-types';
import type { NutritionTextFragment } from './ocr-input';
import {
  NutritionParseError,
  parseNutritionTable,
  type NutritionParseResult,
} from './parse-nutrition-table';

function layout(
  rows: readonly (readonly string[])[],
  widths: readonly number[] = [170, 130, 150, 90],
): NutritionTextFragment[] {
  const rowHeight = 22;
  const gapX = 18;
  const gapY = 10;
  const fragments: NutritionTextFragment[] = [];
  rows.forEach((row, rowIndex) => {
    let x = 0;
    row.forEach((text, columnIndex) => {
      const width = widths[columnIndex] ?? 110;
      if (text.trim().length > 0) {
        fragments.push({
          text,
          box: {
            x,
            y: rowIndex * (rowHeight + gapY),
            width,
            height: rowHeight,
          },
        });
      }
      x += width + gapX;
    });
    if (row.length === 0) {
      return;
    }
  });
  return fragments;
}

describe('review regressions', () => {
  it.each(['Quantity per 100 g', 'Amount per 100 ml', 'Average per 100 g'])(
    'reads a one-column %s caption',
    (caption) => {
      const basis = caption.endsWith('ml') ? 'per_100_ml' : 'per_100_g';
      const result = parse([[caption], ['Sugars', '12 g']], [240, 100]);
      expect(quantity(result, 'sugars', basis)).toBe(12);
    },
  );

  it.each(['-', '\u2013', '\u2014', '\u2022', '\u00b7'])(
    'reads a nutrient row with the %s list marker',
    (marker) => {
      const result = parse([
        ['Nutrient', 'Per 100 g'],
        [`${marker} of which Sugars`, '12 g'],
        [`${marker} Saturated fat`, '3 g'],
        ['of which: Added sugars', '4 g'],
      ]);
      expect(quantity(result, 'sugars', 'per_100_g')).toBe(12);
      expect(quantity(result, 'saturates', 'per_100_g')).toBe(3);
      expect(quantity(result, 'added_sugars', 'per_100_g')).toBe(4);
    },
  );

  it.each(['Quantity per 100 g', 'Amount per 100 g', 'Average per 100 g'])(
    'keeps the explicit basis from %s',
    (header) => {
      const result = parse([
        ['Nutrient', header],
        ['Sugars', '12 g'],
      ]);
      expect(quantity(result, 'sugars', 'per_100_g')).toBe(12);
    },
  );

  it.each(['Quantity per 100 ml', 'Amount per 100 ml', 'Average per 100 ml'])(
    'keeps millilitres from the column header %s',
    (header) => {
      const result = parse([
        ['Nutrient', header],
        ['Sugars', '8 g'],
      ]);
      expect(quantity(result, 'sugars', 'per_100_ml')).toBe(8);
      expect(value(result, 'sugars', 'per_100_g')).toBeUndefined();
    },
  );

  it('reads Quantity per 100 g beside Quantity per serving', () => {
    const result = parse([
      ['Nutrient', 'Quantity per 100 g', 'Quantity per serving'],
      ['Sugars', '12 g', '4 g'],
    ]);
    expect(quantity(result, 'sugars', 'per_100_g')).toBe(12);
    expect(quantity(result, 'sugars', 'per_serving')).toBe(4);
  });

  it('does not guess a unit from Quantity per 100', () => {
    const result = parse([
      ['Nutrient', 'Quantity per 100'],
      ['Fat', '10 g'],
    ]);
    expect(value(result, 'fat', 'per_100_g')).toBeUndefined();
    expect(value(result, 'fat', 'per_100_ml')).toBeUndefined();
    expect(missing(result, 'fat')).toMatchObject({
      reason: 'unsupported_basis',
    });
  });

  it('reads a colon after of which', () => {
    const result = parse([
      ['Nutrient', 'Per 100 g'],
      ['of which: sugars', '12 g'],
      ['of which: saturates', '3 g'],
    ]);
    expect(quantity(result, 'sugars', 'per_100_g')).toBe(12);
    expect(quantity(result, 'saturates', 'per_100_g')).toBe(3);
  });

  it('flags conflicting energy when the printed kJ is zero', () => {
    const result = parse([
      ['Nutrient', 'Per 100 g'],
      ['Energy', '0 kJ / 25 kcal'],
    ]);
    const energy = value(result, 'energy', 'per_100_g');
    expect(quantity(result, 'energy', 'per_100_g')).toBe(0);
    expect(
      energy !== undefined &&
        energy.kind !== 'missing' &&
        energy.issues.some((issue) => issue.code === 'energy_figures_disagree'),
    ).toBe(true);
  });
});

function parse(
  rows: readonly (readonly string[])[],
  widths?: readonly number[],
): NutritionParseResult {
  return check(parseNutritionTable(layout(rows, widths)));
}

function check(result: NutritionParseResult): NutritionParseResult {
  const ids = new Set<string>();
  for (const observation of result.observations) {
    if (observation.kind !== 'missing') {
      for (const id of observation.sourceIds) {
        ids.add(id);
      }
    }
  }
  const request = {
    contractVersion: '0.3.0-draft',
    product: {
      barcode: null,
      name: null,
      market: 'IN',
      ingredientsText: null,
      ingredientsStatus: 'missing',
      observations: result.observations,
      sourceRefs: [...ids].map((id) => ({
        id,
        kind: 'label' as const,
        title: 'Nutrition panel' as const,
        edition: '2026-10-16T00:00:00Z',
      })),
      issues: result.issues,
    },
    resourceCompatibility: {
      taxonomyVersion: 'test',
      evidenceVersion: 'test',
      methodEdition: 'test',
      methodBundleSha256: '0'.repeat(64),
    },
  };
  const accepted = validateAnalyzeRequest(request);
  if (!accepted) {
    throw new Error(validationDetail(validateAnalyzeRequest));
  }
  return result;
}

function value(
  result: NutritionParseResult,
  field: string,
  basis: 'per_100_g' | 'per_100_ml' | 'per_serving',
) {
  return result.observations.find(
    (observation) =>
      observation.field === field &&
      observation.kind !== 'missing' &&
      observation.basis === basis,
  );
}

function quantity(
  result: NutritionParseResult,
  field: string,
  basis: 'per_100_g' | 'per_100_ml' | 'per_serving',
): number | undefined {
  const found = value(result, field, basis);
  if (found === undefined || found.kind === 'missing') {
    return undefined;
  }
  return found.value;
}

function missing(result: NutritionParseResult, field: string) {
  return result.observations.find(
    (observation) =>
      observation.field === field && observation.kind === 'missing',
  );
}

const INDIAN = [
  ['', 'Per 100 g', 'Per serve (30 g)', '% RDA*'],
  ['Energy', '450 kcal', '135 kcal', '6.8%'],
  ['Protein', '7.0 g', '2.1 g', '—'],
  ['Total Carbohydrate', '72 g', '21.6 g', '—'],
  ['of which Sugars', '18 g', '5.4 g', '—'],
  ['of which Added Sugars', '16 g', '4.8 g', '—'],
  ['Total Fat', '20 g', '6 g', '9%'],
  ['Saturated Fat', '8 g', '2.4 g', '12%'],
  ['Trans Fat', '0 g', '0 g', '—'],
  ['Cholesterol', '0 mg', '0 mg', '—'],
  ['Sodium', '280 mg', '84 mg', '4%'],
  ['Dietary Fibre', '3.5 g', '1.1 g', '—'],
] as const;

function indianTable(): NutritionParseResult {
  return parse(INDIAN);
}

describe('Indian table geometry', () => {
  it('keeps per 100 g and per serving apart and ignores %RDA', () => {
    const result = indianTable();
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 18,
      unit: 'g',
    });
    expect(value(result, 'sugars', 'per_serving')).toMatchObject({
      kind: 'read',
      value: 5.4,
      unit: 'g',
    });
    expect(value(result, 'fat', 'per_100_g')).toMatchObject({ value: 20 });
    expect(value(result, 'fat', 'per_serving')).toMatchObject({ value: 6 });
    expect(value(result, 'saturates', 'per_100_g')).toMatchObject({ value: 8 });
    expect(value(result, 'protein', 'per_100_g')).toMatchObject({ value: 7 });
    expect(value(result, 'protein', 'per_serving')).toMatchObject({
      value: 2.1,
    });
    expect(
      result.observations.some(
        (observation) =>
          observation.kind !== 'missing' && observation.unit === 'percent',
      ),
    ).toBe(false);
    expect(
      result.observations.some((observation) => observation.field === 'fvl'),
    ).toBe(false);
  });

  it('does not turn a 30 g serving into a per 100 g amount', () => {
    const result = indianTable();
    const serving = value(result, 'sugars', 'per_serving');
    expect(
      serving?.kind === 'read' || serving?.kind === 'uncertain'
        ? serving.value
        : undefined,
    ).toBe(5.4);
    expect(
      serving?.kind !== 'missing' && serving?.derivation?.join(' '),
    ).toContain('30 g');
    expect(
      serving?.kind !== 'missing' && serving?.derivation?.join(' '),
    ).toContain('not converted');
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({ value: 18 });
  });

  it('keeps added sugars off the total sugars field', () => {
    const result = indianTable();
    expect(value(result, 'added_sugars', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 16,
      unit: 'g',
    });
    expect(value(result, 'added_sugars', 'per_serving')).toMatchObject({
      value: 4.8,
    });
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({ value: 18 });
  });

  it('converts sodium milligrams and derives salt with the Annex I formula', () => {
    const result = indianTable();
    expect(value(result, 'sodium', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 0.28,
      unit: 'g',
    });
    expect(value(result, 'sodium', 'per_serving')).toMatchObject({
      value: 0.084,
    });
    const salt = value(result, 'salt', 'per_100_g');
    const servingSalt = value(result, 'salt', 'per_serving');
    expect(salt).toMatchObject({
      kind: 'read',
      value: 0.7,
      unit: 'g',
      basis: 'per_100_g',
    });
    expect(servingSalt).toMatchObject({ value: 0.21, basis: 'per_serving' });
    const note =
      salt?.kind !== 'missing' ? (salt?.derivation ?? []).join(' ') : '';
    expect(note).toContain('1169/2011');
    expect(note).toContain('2,5');
    expect(note).toContain('Annex I');
    expect(note).toContain('280 mg');
  });

  it('derives kilojoules from kilocalories and leaves carbohydrate, trans fat, and cholesterol out', () => {
    const result = indianTable();
    expect(value(result, 'energy', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 1882.8,
      unit: 'kJ',
    });
    expect(value(result, 'energy', 'per_serving')).toMatchObject({
      value: 564.84,
      unit: 'kJ',
    });
    const energyNote = value(result, 'energy', 'per_100_g');
    expect(
      energyNote?.kind !== 'missing' && energyNote?.derivation?.join(' '),
    ).toContain('4.184');
    expect(
      energyNote?.kind !== 'missing' && energyNote?.derivation?.join(' '),
    ).toContain('fao.org');
    expect(result.ignoredLabels).toEqual(
      expect.arrayContaining([
        'total carbohydrate',
        'trans fat',
        'cholesterol',
      ]),
    );
    expect(
      result.observations.some(
        (observation) => observation.field === 'carbohydrate',
      ),
    ).toBe(false);
    expect(value(result, 'fibre', 'per_100_g')).toMatchObject({ value: 3.5 });
    expect(missing(result, 'fibre')).toBeUndefined();
  });
});

describe('column assignment', () => {
  it('uses box position when the serving value is listed first', () => {
    const fragments = layout([
      ['', 'Per 100 g', 'Per serve (30 g)'],
      ['Sugars', '18 g', '5.4 g'],
    ]);
    const reversed = [...fragments].reverse();
    const result = check(parseNutritionTable(reversed));
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({ value: 18 });
    expect(value(result, 'sugars', 'per_serving')).toMatchObject({
      value: 5.4,
    });
  });

  it('does not assign a value that sits between two headers', () => {
    const result = check(
      parseNutritionTable([
        { text: 'Per 100 g', box: { x: 100, y: 0, width: 80, height: 20 } },
        { text: 'Per serve', box: { x: 300, y: 0, width: 80, height: 20 } },
        { text: 'Sugars', box: { x: 0, y: 40, width: 80, height: 20 } },
        { text: '9 g', box: { x: 200, y: 40, width: 80, height: 20 } },
      ]),
    );
    expect(value(result, 'sugars', 'per_100_g')).toBeUndefined();
    expect(value(result, 'sugars', 'per_serving')).toBeUndefined();
    expect(missing(result, 'sugars')).toMatchObject({ reason: 'ambiguous' });
    expect(
      missing(result, 'sugars')?.kind === 'missing' &&
        missing(result, 'sugars')?.issues[0]?.code,
    ).toBe('column_ambiguous');
  });

  it('joins a wrapped energy line by line id and does not join rows that only share a block id', () => {
    const split = check(
      parseNutritionTable([
        {
          text: 'Per 100 g',
          box: { x: 160, y: 0, width: 100, height: 18 },
          lineId: 'h',
        },
        {
          text: 'Energy',
          box: { x: 0, y: 40, width: 100, height: 18 },
          lineId: 'e',
        },
        {
          text: '380 kJ',
          box: { x: 160, y: 70, width: 100, height: 18 },
          lineId: 'e',
        },
      ]),
    );
    expect(value(split, 'energy', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 380,
      unit: 'kJ',
    });

    const blocked = check(
      parseNutritionTable([
        {
          text: 'Per 100 g',
          box: { x: 160, y: 0, width: 100, height: 18 },
          blockId: 'table',
        },
        {
          text: 'Energy',
          box: { x: 0, y: 40, width: 100, height: 18 },
          blockId: 'table',
        },
        {
          text: '400 kJ',
          box: { x: 160, y: 40, width: 100, height: 18 },
          blockId: 'table',
        },
        {
          text: 'Sugars',
          box: { x: 0, y: 80, width: 100, height: 18 },
          blockId: 'table',
        },
        {
          text: '4 g',
          box: { x: 160, y: 80, width: 100, height: 18 },
          blockId: 'table',
        },
      ]),
    );
    expect(value(blocked, 'energy', 'per_100_g')).toMatchObject({ value: 400 });
    expect(value(blocked, 'sugars', 'per_100_g')).toMatchObject({ value: 4 });
  });

  it('reads a serving size printed on the line under Per serve', () => {
    const result = parse([
      ['', 'Per 100 g', 'Per serve', '%RDA'],
      ['', '', '(30 g)', ''],
      ['Fat', '10 g', '3 g', '5%'],
    ]);
    const perServe = value(result, 'fat', 'per_serving');
    expect(value(result, 'fat', 'per_100_g')).toMatchObject({ value: 10 });
    expect(perServe).toMatchObject({ value: 3 });
    const perServeLines =
      perServe !== undefined && perServe.kind !== 'missing'
        ? (perServe.derivation ?? []).join(' ')
        : '';
    expect(perServeLines).toContain('30 g');
  });
});

describe('basis is never guessed', () => {
  it('omits a missing fibre row and records a printed zero', () => {
    const result = parse([
      ['', 'Per 100 g'],
      ['Sugars', '0 g'],
      ['Fat', '10 g'],
    ]);
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 0,
      unit: 'g',
    });
    expect(missing(result, 'sugars')).toBeUndefined();
    expect(
      result.observations.some((observation) => observation.field === 'fibre'),
    ).toBe(false);
  });

  it('records Nil as zero and a dash as not declared', () => {
    const nil = parse([
      ['', 'Per 100 g'],
      ['Saturates', 'Nil'],
    ]);
    expect(value(nil, 'saturates', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 0,
    });
    expect(
      value(nil, 'saturates', 'per_100_g')?.kind === 'read' &&
        value(nil, 'saturates', 'per_100_g')?.issues[0]?.code,
    ).toBe('nil_marker');

    const dash = parse([
      ['', 'Per 100 g'],
      ['Fibre', '—'],
    ]);
    expect(value(dash, 'fibre', 'per_100_g')).toBeUndefined();
    expect(missing(dash, 'fibre')).toMatchObject({ reason: 'not_declared' });
    expect(
      missing(dash, 'fibre')?.kind === 'missing' &&
        missing(dash, 'fibre')?.issues[0]?.code,
    ).toBe('dash_not_zero');
  });

  it('keeps an inequality and the word trace uncertain', () => {
    const bound = parse([
      ['', 'Per 100 g'],
      ['Saturates', '<0.5 g'],
    ]);
    expect(value(bound, 'saturates', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 0.5,
      unit: 'g',
    });
    expect(
      value(bound, 'saturates', 'per_100_g')?.kind === 'uncertain' &&
        value(bound, 'saturates', 'per_100_g')?.issues[0]?.code,
    ).toBe('upper_bound');

    const trace = parse([
      ['', 'Per 100 g'],
      ['Salt', 'trace'],
    ]);
    expect(value(trace, 'salt', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 0,
    });
    expect(
      value(trace, 'salt', 'per_100_g')?.kind === 'uncertain' &&
        value(trace, 'salt', 'per_100_g')?.issues[0]?.code,
    ).toBe('trace_amount');
    expect(resultHasSaltDerivedFromNowhere(trace)).toBe(false);
  });

  it('accepts a worded bound and an inclusive bound', () => {
    const worded = parse([
      ['', 'Per 100 g'],
      ['Sugars', 'less than 0.5 g'],
    ]);
    expect(value(worded, 'sugars', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 0.5,
    });
    const inclusive = parse([
      ['', 'Per 100 g'],
      ['Salt', '≤ 0.2 g'],
    ]);
    expect(value(inclusive, 'salt', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 0.2,
    });
    expect(
      value(inclusive, 'salt', 'per_100_g')?.kind === 'uncertain' &&
        value(inclusive, 'salt', 'per_100_g')?.issues[0]?.code,
    ).toBe('upper_bound_inclusive');
    const lower = parse([
      ['', 'Per 100 g'],
      ['Protein', '> 5 g'],
    ]);
    expect(
      value(lower, 'protein', 'per_100_g')?.kind === 'uncertain' &&
        value(lower, 'protein', 'per_100_g')?.issues[0]?.code,
    ).toBe('lower_bound');
  });

  it('does not guess grams or millilitres when the header is missing or only says per 100', () => {
    const bare = parse([['Sugars', '18 g', '5 g']], [160, 100, 100]);
    expect(value(bare, 'sugars', 'per_100_g')).toBeUndefined();
    expect(value(bare, 'sugars', 'per_100_ml')).toBeUndefined();
    expect(missing(bare, 'sugars')).toMatchObject({
      reason: 'unsupported_basis',
    });

    const incomplete = parse([
      ['', 'Per 100'],
      ['Fat', '10 g'],
    ]);
    expect(value(incomplete, 'fat', 'per_100_g')).toBeUndefined();
    expect(value(incomplete, 'fat', 'per_100_ml')).toBeUndefined();
    expect(missing(incomplete, 'fat')).toMatchObject({
      reason: 'unsupported_basis',
    });
  });

  it('reads per 100 ml as millilitres and does not copy it onto per 100 g', () => {
    const result = parse([
      ['', 'Per 100 ml', 'Per serving (200 ml)'],
      ['Sugars', '8.5 g', '17 g'],
    ]);
    expect(value(result, 'sugars', 'per_100_ml')).toMatchObject({
      value: 8.5,
      basis: 'per_100_ml',
    });
    expect(value(result, 'sugars', 'per_serving')).toMatchObject({ value: 17 });
    expect(value(result, 'sugars', 'per_100_g')).toBeUndefined();
  });

  it('uses a one-column caption and still refuses a two-column caption', () => {
    const one = parse(
      [['Typical values per 100 g'], ['Fat', '10 g']],
      [220, 100],
    );
    expect(value(one, 'fat', 'per_100_g')).toMatchObject({ value: 10 });

    const two = parse(
      [['Typical values per 100 g'], ['Fat', '10 g', '3 g']],
      [220, 100, 100],
    );
    expect(value(two, 'fat', 'per_100_g')).toBeUndefined();
    expect(missing(two, 'fat')).toMatchObject({ reason: 'unsupported_basis' });
  });

  it('reads Per 100g* and per 100 gm', () => {
    const starred = parse([
      ['', 'Per 100g*'],
      ['Protein', '6 g*'],
    ]);
    expect(value(starred, 'protein', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 6,
    });
    const grams = parse([
      ['', 'per 100 gm'],
      ['Fat', '11 g'],
    ]);
    expect(value(grams, 'fat', 'per_100_g')).toMatchObject({ value: 11 });
  });
});

describe('units, sugars, and salt', () => {
  it('keeps a printed kilojoule figure when kilocalories are also printed', () => {
    const result = parse([
      ['', 'Per 100 g', 'Per serving (125 g)'],
      ['Energy', '380 kJ', '475 kJ'],
      ['', '91 kcal', '114 kcal'],
      ['Fat', '3.2 g', '4 g'],
      ['of which saturates', '2.1 g', '2.6 g'],
      ['Carbohydrate', '12 g', '15 g'],
      ['of which sugars', '12 g', '15 g'],
      ['Fibre', '0 g', '0 g'],
      ['Protein', '3.5 g', '4.4 g'],
      ['Salt', '0.12 g', '0.15 g'],
    ]);
    const energy = value(result, 'energy', 'per_100_g');
    expect(energy).toMatchObject({ kind: 'read', value: 380, unit: 'kJ' });
    expect(
      energy?.kind !== 'missing' && energy?.derivation?.join(' '),
    ).toContain('91 kcal');
    expect(
      energy?.kind !== 'missing' && energy?.derivation?.join(' '),
    ).not.toContain('× 4.184 =');
    expect(value(result, 'energy', 'per_serving')).toMatchObject({
      value: 475,
    });
    expect(value(result, 'saturates', 'per_100_g')).toMatchObject({
      value: 2.1,
    });
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({ value: 12 });
    expect(value(result, 'fibre', 'per_100_g')).toMatchObject({ value: 0 });
    const declaredSalt = value(result, 'salt', 'per_100_g');
    expect(declaredSalt).toMatchObject({ kind: 'read', value: 0.12 });
    const declaredLines =
      declaredSalt !== undefined && declaredSalt.kind !== 'missing'
        ? declaredSalt.derivation
        : undefined;
    expect(declaredLines).toBeUndefined();
    expect(
      result.observations.some((observation) => observation.field === 'sodium'),
    ).toBe(false);
  });

  it('flags kilojoules that disagree with the printed kilocalories and still keeps the kilojoules', () => {
    const result = parse([
      ['', 'Per 100 g'],
      ['Energy', '2000 kJ / 400 kcal'],
    ]);
    expect(value(result, 'energy', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 2000,
      unit: 'kJ',
    });
    expect(
      value(result, 'energy', 'per_100_g')?.kind === 'read' &&
        value(result, 'energy', 'per_100_g')?.issues.some(
          (issue) => issue.code === 'energy_figures_disagree',
        ),
    ).toBe(true);
  });

  it('does not derive salt when salt is already declared, including a dash', () => {
    const declared = parse([
      ['', 'Per 100 g'],
      ['Sodium', '400 mg'],
      ['Salt', '1.2 g'],
    ]);
    expect(value(declared, 'sodium', 'per_100_g')).toMatchObject({
      value: 0.4,
    });
    expect(value(declared, 'salt', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 1.2,
    });
    const declaredSalt = value(declared, 'salt', 'per_100_g');
    const declaredLines =
      declaredSalt?.kind !== 'missing' ? (declaredSalt?.derivation ?? []) : [];
    expect(declaredLines.some((line) => line.includes('2.5'))).toBe(false);

    const dashed = parse([
      ['', 'Per 100 g'],
      ['Sodium', '400 mg'],
      ['Salt', '—'],
    ]);
    expect(value(dashed, 'salt', 'per_100_g')).toBeUndefined();
    expect(missing(dashed, 'salt')).toMatchObject({ reason: 'not_declared' });
  });

  it('derives uncertain salt from an uncertain sodium amount, on that basis only', () => {
    const result = parse([
      ['', 'Per 100 g', 'Per serve'],
      ['Sodium', '<0.2 g', '0.05 g'],
    ]);
    expect(value(result, 'salt', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 0.5,
      basis: 'per_100_g',
    });
    expect(value(result, 'salt', 'per_serving')).toMatchObject({
      kind: 'read',
      value: 0.125,
      basis: 'per_serving',
    });
    expect(
      value(result, 'salt', 'per_100_g')?.kind === 'uncertain' &&
        value(result, 'salt', 'per_100_g')?.issues.some(
          (issue) => issue.code === 'upper_bound',
        ),
    ).toBe(true);
  });

  it('reads the unit from the row name and does not invent one for a bare inequality', () => {
    const fromRow = parse([
      ['', 'Per 100 g'],
      ['Sodium (mg)', '280'],
    ]);
    expect(value(fromRow, 'sodium', 'per_100_g')).toMatchObject({
      value: 0.28,
      unit: 'g',
    });

    const bare = parse([
      ['', 'Per 100 g'],
      ['Sugars', '< 1'],
    ]);
    expect(value(bare, 'sugars', 'per_100_g')).toBeUndefined();
    expect(missing(bare, 'sugars')).toMatchObject({ reason: 'ambiguous' });
  });

  it('converts micrograms, repairs an unambiguous glyph, and rejects an ambiguous thousands mark', () => {
    const micro = parse([
      ['', 'Per 100 g'],
      ['Salt', '500 mcg'],
    ]);
    expect(value(micro, 'salt', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 0.0005,
      unit: 'g',
    });

    const glyph = parse([
      ['', 'Per 100 g'],
      ['Sugars', '1O.5 g'],
    ]);
    expect(value(glyph, 'sugars', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 10.5,
    });
    expect(
      value(glyph, 'sugars', 'per_100_g')?.kind === 'read' &&
        value(glyph, 'sugars', 'per_100_g')?.issues[0]?.code,
    ).toBe('ocr_glyph');

    const ambiguous = parse([
      ['', 'Per 100 g'],
      ['Energy', '1,000 kJ'],
    ]);
    expect(value(ambiguous, 'energy', 'per_100_g')).toBeUndefined();
    expect(missing(ambiguous, 'energy')).toMatchObject({ reason: 'ambiguous' });
  });

  it('reads a decimal comma and a spaced decimal, and rejects spaced digits', () => {
    const comma = parse([
      ['', 'Per 100 g'],
      ['Salt', '0,5 g'],
    ]);
    expect(value(comma, 'salt', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 0.5,
    });

    const spaced = parse([
      ['', 'Per 100 g'],
      ['Fat', '12 .5 g'],
    ]);
    expect(value(spaced, 'fat', 'per_100_g')).toMatchObject({ value: 12.5 });

    const broken = parse([
      ['', 'Per 100 g'],
      ['Fat', '1 2.5 g'],
    ]);
    expect(missing(broken, 'fat')).toMatchObject({ reason: 'ambiguous' });
  });

  it('does not read a percent in a mass column as grams, and does read fruit content as percent', () => {
    const percent = parse([
      ['', 'Per 100 g'],
      ['Fat', '6%'],
    ]);
    expect(value(percent, 'fat', 'per_100_g')).toBeUndefined();
    expect(
      missing(percent, 'fat')?.kind === 'missing' &&
        missing(percent, 'fat')?.issues[0]?.code,
    ).toBe('percent_is_not_mass');

    const fruit = parse([
      ['', 'Per 100 g'],
      ['Fruits, vegetables and legumes', '40%'],
    ]);
    expect(value(fruit, 'fvl', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 40,
      unit: 'percent',
    });
  });

  it('keeps conflicting duplicates out and merges identical ones', () => {
    const conflict = check(
      parseNutritionTable([
        { text: 'Per 100 g', box: { x: 140, y: 0, width: 80, height: 18 } },
        { text: 'Sugars', box: { x: 0, y: 36, width: 80, height: 18 } },
        { text: '10 g', box: { x: 140, y: 36, width: 70, height: 18 } },
        { text: 'Sugars', box: { x: 0, y: 72, width: 80, height: 18 } },
        { text: '12 g', box: { x: 140, y: 72, width: 70, height: 18 } },
      ]),
    );
    expect(value(conflict, 'sugars', 'per_100_g')).toBeUndefined();
    expect(missing(conflict, 'sugars')).toMatchObject({
      reason: 'conflicting_sources',
    });

    const same = check(
      parseNutritionTable([
        { text: 'Per 100 g', box: { x: 140, y: 0, width: 80, height: 18 } },
        { text: 'Sugars', box: { x: 0, y: 36, width: 80, height: 18 } },
        { text: '10 g', box: { x: 140, y: 36, width: 70, height: 18 } },
        { text: 'Sugars', box: { x: 0, y: 72, width: 80, height: 18 } },
        { text: '10 g', box: { x: 140, y: 72, width: 70, height: 18 } },
      ]),
    );
    const merged = value(same, 'sugars', 'per_100_g');
    expect(merged).toMatchObject({ kind: 'read', value: 10 });
    expect(
      merged?.kind !== 'missing' && merged?.sourceIds.length,
    ).toBeGreaterThan(1);
  });

  it('flags a mass above 100 g per 100 g and still keeps it', () => {
    const result = parse([
      ['', 'Per 100 g'],
      ['Sugars', '150 g'],
    ]);
    expect(value(result, 'sugars', 'per_100_g')).toMatchObject({
      kind: 'read',
      value: 150,
    });
    expect(
      value(result, 'sugars', 'per_100_g')?.kind === 'read' &&
        value(result, 'sugars', 'per_100_g')?.issues[0]?.code,
    ).toBe('mass_over_base');
  });

  it('treats not detected and a tilde as uncertain', () => {
    const detected = parse([
      ['', 'Per 100 g'],
      ['Salt', 'ND'],
    ]);
    expect(value(detected, 'salt', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 0,
    });
    const approx = parse([
      ['', 'Per 100 g'],
      ['Fat', '~10 g'],
    ]);
    expect(value(approx, 'fat', 'per_100_g')).toMatchObject({
      kind: 'uncertain',
      value: 10,
    });
    expect(
      value(approx, 'fat', 'per_100_g')?.kind === 'uncertain' &&
        value(approx, 'fat', 'per_100_g')?.issues[0]?.code,
    ).toBe('approximate_value');
  });

  it('reads American fiber and does not let trans fat become saturates', () => {
    const result = parse([
      ['', 'Per 100g'],
      ['Total Fat', '9 g'],
      ['Trans Fat', '1 g'],
      ['Dietary Fiber', '2 g'],
    ]);
    expect(value(result, 'fat', 'per_100_g')).toMatchObject({ value: 9 });
    expect(value(result, 'saturates', 'per_100_g')).toBeUndefined();
    expect(value(result, 'fibre', 'per_100_g')).toMatchObject({ value: 2 });
    expect(result.ignoredLabels).toContain('trans fat');
  });
});

describe('caller contract', () => {
  it('returns no observations for an empty table', () => {
    expect(check(parseNutritionTable([])).observations).toEqual([]);
  });

  it('assigns src-0 in input order and accepts caller ids', () => {
    const fragments = layout([
      ['', 'Per 100 g'],
      ['Fat', '4 g'],
    ]);
    const result = check(parseNutritionTable(fragments));
    const fat = value(result, 'fat', 'per_100_g');
    expect(
      fat?.kind !== 'missing' &&
        fat?.sourceIds.every((id) => /^src-[0-9]+$/.test(id)),
    ).toBe(true);

    const custom = check(
      parseNutritionTable(fragments, {
        sourceIds: fragments.map((_, index) => `src-${index + 3}`),
      }),
    );
    const customFat = value(custom, 'fat', 'per_100_g');
    const customIds =
      customFat !== undefined && customFat.kind !== 'missing'
        ? [...customFat.sourceIds]
        : [];
    expect(customIds).toEqual(['src-4', 'src-5']);
  });

  it('rejects a source id that is not src-N', () => {
    const fragments = layout([
      ['', 'Per 100 g'],
      ['Fat', '4 g'],
    ]);
    expect(() =>
      parseNutritionTable(fragments, {
        sourceIds: fragments.map(() => 'device-1'),
      }),
    ).toThrow(NutritionParseError);
  });

  it('skips a box that cannot be placed', () => {
    const result = check(
      parseNutritionTable([
        { text: 'Per 100 g', box: { x: 120, y: 0, width: 80, height: 18 } },
        { text: 'Fat', box: { x: Number.NaN, y: 30, width: 80, height: 18 } },
        { text: '4 g', box: { x: 120, y: 30, width: 80, height: 18 } },
      ]),
    );
    expect(result.issues.some((issue) => issue.code === 'invalid_box')).toBe(
      true,
    );
    expect(value(result, 'fat', 'per_100_g')).toBeUndefined();
  });
});

function resultHasSaltDerivedFromNowhere(
  result: NutritionParseResult,
): boolean {
  const salt = value(result, 'salt', 'per_100_g');
  return (
    salt?.kind !== 'missing' &&
    (salt?.derivation ?? []).some((line) => line.includes('2.5'))
  );
}
