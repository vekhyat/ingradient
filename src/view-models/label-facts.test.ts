import { describe, expect, it } from '@jest/globals';

import { parseIngredients } from '../domain/ingredients';
import { INGREDIENT_MENTION_LIMIT } from '../domain/ingredients/limits';
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

  it('retains root-level items from product wrapper statements', () => {
    const facts = labelFactsFromText(
      'Ingredients: rice. This product may contain traces of milk, nuts and soy.',
    );
    expect(facts.mayContain).toEqual(['milk', 'nuts', 'soy']);
    expect(facts.contains).toEqual([]);
  });

  it('omits nested statement headers while retaining their items', () => {
    const facts = labelFactsFromText(
      'Ingredients: sauce (Contains: milk, soy), rice. May contain: nuts.',
    );
    expect(facts.contains).toEqual(['milk', 'soy']);
    expect(facts.mayContain).toEqual(['nuts']);
  });

  it('omits headers even when there are no parsed children', () => {
    const facts = labelFactsFromText('Contains: . May contain traces of: .');
    expect(facts.contains).toEqual([]);
    expect(facts.mayContain).toEqual([]);
  });

  it('does not expose a childless statement header at the mention limit', () => {
    const text = `${Array.from({ length: INGREDIENT_MENTION_LIMIT - 1 }, () => 'rice').join(', ')}. Contains: milk.`;
    const parsed = parseIngredients(text);
    const header = parsed.mentions.find(
      (mention) => mention.role === 'allergen_contains',
    );
    expect(header?.name).toBe('Contains');
    expect(
      parsed.mentions.some((mention) => mention.parentId === header?.id),
    ).toBe(false);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'mention_limit' }),
      ]),
    );
    expect(labelFactsFromText(text).contains).toEqual([]);
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

  it.each([
    ['150(a)', '150a'],
    ['E150(d)', '150d'],
  ])('canonicalizes the letter suffix in %s', (written, canonical) => {
    expect(lookupAdditiveName(written)).not.toBeNull();
    expect(lookupAdditiveName(written)).toBe(lookupAdditiveName(canonical));
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
