import { describe, expect, it } from '@jest/globals';

import { labelFactsFromText, lookupAdditiveName } from './label-facts';

const LABEL =
  'INGREDIENTS: Whole wheat flour (atta) (52%), sugar, edible vegetable oil (palm), milk solids (3%), raising agents (INS 500(ii), 503(ii)), emulsifier (E322), salt. CONTAINS WHEAT, MILK. MAY CONTAIN NUTS AND SOY.';

describe('labelFactsFromText', () => {
  const facts = labelFactsFromText(LABEL);

  it('keeps top-level ingredients in pack order', () => {
    expect(facts.topLevel).toEqual([
      'Whole wheat flour',
      'sugar',
      'edible vegetable oil',
      'milk solids',
      'raising agents',
      'emulsifier',
      'salt',
    ]);
  });

  it('keeps declared percentages as printed', () => {
    expect(facts.percentages).toEqual([
      { name: 'Whole wheat flour', text: '52%' },
      { name: 'milk solids', text: '3%' },
    ]);
  });

  it('names additives from the pinned taxonomy and keeps the printed class', () => {
    expect(facts.additives).toEqual([
      {
        written: 'INS 500(ii)',
        code: '500(ii)',
        name: 'Sodium hydrogen carbonate',
        printedClass: 'raising agents',
      },
      {
        written: '503(ii)',
        code: '503(ii)',
        name: 'Ammonium hydrogen carbonate',
        printedClass: 'raising agents',
      },
      {
        written: 'E322',
        code: '322',
        name: 'Lecithins',
        printedClass: 'emulsifier',
      },
    ]);
  });

  it('separates "Contains" from "May contain" statements', () => {
    expect(facts.contains).toEqual(['wheat', 'milk']);
    expect(facts.mayContain).toEqual(['nuts', 'soy']);
  });

  it('credits the additive names', () => {
    expect(facts.additiveNameCredit).toMatch(/Open Food Facts/);
  });
});

describe('lookupAdditiveName', () => {
  it('does not guess a name for an unknown code', () => {
    expect(lookupAdditiveName('9999')).toBeNull();
  });

  it('treats 503(ii) and 503 as different identities', () => {
    expect(lookupAdditiveName('503(ii)')).toBe('Ammonium hydrogen carbonate');
    expect(lookupAdditiveName('503')).not.toBe('Ammonium hydrogen carbonate');
  });
});

describe('a label with no statements', () => {
  it('returns empty lists, not invented ones', () => {
    const facts = labelFactsFromText('Ingredients: rice, salt.');
    expect(facts.additives).toEqual([]);
    expect(facts.contains).toEqual([]);
    expect(facts.mayContain).toEqual([]);
    expect(facts.topLevel).toEqual(['rice', 'salt']);
  });
});
