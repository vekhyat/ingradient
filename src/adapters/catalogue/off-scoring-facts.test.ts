import { describe, expect, it } from '@jest/globals';
import { localValidators } from '../../domain/contracts';
import { mapOffProductToSnapshot } from './off-mapper';
import { deriveScoringFacts } from './off-scoring-facts';
import type { OffIngredientV3, OffProductV3 } from './types';

const SOURCE = 'off:0000000000000';

/** A recognised OFF ingredient with its analysis flags. */
function ingredient(
  id: string,
  flags: Partial<OffIngredientV3> = {},
): OffIngredientV3 {
  return {
    id,
    text: id.replace(/^en:/, ''),
    is_in_taxonomy: 1,
    vegan: 'yes',
    vegetarian: 'yes',
    ...flags,
  };
}

const MILK = ingredient('en:milk', { vegan: 'no' });
const BEEF = ingredient('en:beef', { vegan: 'no', vegetarian: 'no' });
const WATER = ingredient('en:water');
const SUGAR = ingredient('en:sugar');

function facts(
  product: OffProductV3,
  category: Parameters<typeof deriveScoringFacts>[1] = 'general',
) {
  return (
    deriveScoringFacts(product, category, SOURCE) ?? {
      categorySourceIds: [],
      cheese: { state: 'unknown' },
      redMeat: { state: 'unknown' },
      plainWater: { state: 'unknown' },
      nonNutritiveSweetener: { state: 'unknown' },
    }
  );
}

describe('deriveScoringFacts', () => {
  describe('cheese', () => {
    it('is present for an en:cheeses product on the general route', () => {
      const result = facts({ categories_tags: ['en:dairies', 'en:cheeses'] });
      expect(result?.cheese).toEqual({ state: 'present', sourceIds: [SOURCE] });
    });

    it('excludes fromages blancs, following the OFF cheese rule', () => {
      const result = facts({
        categories_tags: ['en:cheeses', 'fr:fromages-blancs'],
      });
      expect(result?.cheese).toEqual({ state: 'unknown' });
    });

    it('stays unknown when the tag is missing, even with milk', () => {
      const result = facts({
        categories_tags: ['en:biscuits'],
        ingredients: [SUGAR, MILK],
      });
      expect(result?.cheese).toEqual({ state: 'unknown' });
    });

    it('stays unknown for a recognised vegan list without completeness evidence', () => {
      const result = facts({
        categories_tags: ['en:breads'],
        ingredients: [ingredient('en:wheat-flour'), WATER],
      });
      expect(result?.cheese).toEqual({ state: 'unknown' });
    });

    it('stays unknown when one ingredient is not recognised', () => {
      const result = facts({
        categories_tags: ['en:breads'],
        ingredients: [
          ingredient('en:wheat-flour'),
          ingredient('en:mystery', { is_in_taxonomy: 0 }),
        ],
      });
      expect(result?.cheese).toEqual({ state: 'unknown' });
    });

    it('does not read a non-English cheese tag as en:cheeses', () => {
      const result = facts({ categories_tags: ['fr:fromages'] });
      expect(result?.cheese).toEqual({ state: 'unknown' });
    });

    it('stays unknown on a route the contract does not allow', () => {
      const result = facts(
        { categories_tags: ['en:cheeses', 'en:beverages'] },
        'beverage',
      );
      expect(result?.cheese).toEqual({ state: 'unknown' });
    });
  });

  describe('red meat', () => {
    it.each(['en:beef', 'en:pork', 'en:lamb-meat', 'en:horse-meat'])(
      'is present for %s',
      (tag) => {
        const result = facts({ categories_tags: ['en:meats', tag] });
        expect(result?.redMeat).toEqual({
          state: 'present',
          sourceIds: [SOURCE],
        });
      },
    );

    it('stays unknown for meat without a red-meat tag', () => {
      const result = facts({ categories_tags: ['en:meats', 'en:chickens'] });
      expect(result?.redMeat).toEqual({ state: 'unknown' });
    });

    it('stays unknown for a recognised vegetarian list without completeness evidence', () => {
      const result = facts({
        categories_tags: ['en:biscuits'],
        ingredients: [SUGAR, MILK],
      });
      expect(result?.redMeat).toEqual({ state: 'unknown' });
    });

    it('stays unknown when an ingredient is not vegetarian', () => {
      const result = facts({
        categories_tags: ['en:ready-meals'],
        ingredients: [SUGAR, BEEF],
      });
      expect(result?.redMeat).toEqual({ state: 'unknown' });
    });

    it('checks nested sub-ingredients too', () => {
      const result = facts({
        categories_tags: ['en:ready-meals'],
        ingredients: [ingredient('en:sauce', { ingredients: [BEEF] })],
      });
      expect(result?.redMeat).toEqual({ state: 'unknown' });
    });

    it('makes both unknown when cheese and red-meat tags conflict', () => {
      const result = facts({ categories_tags: ['en:cheeses', 'en:beef'] });
      expect(result?.cheese).toEqual({ state: 'unknown' });
      expect(result?.redMeat).toEqual({ state: 'unknown' });
    });
  });

  describe('plain water', () => {
    const beverage = (product: OffProductV3) => facts(product, 'beverage');

    it('is present for a mineral water', () => {
      const result = beverage({
        categories_tags: ['en:waters', 'en:spring-waters', 'en:mineral-waters'],
        ingredients: [ingredient('en:natural-mineral-water')],
      });
      expect(result?.plainWater).toEqual({
        state: 'present',
        sourceIds: [SOURCE],
      });
    });

    it('is absent for a flavoured water', () => {
      const result = beverage({
        categories_tags: [
          'en:waters',
          'en:spring-waters',
          'en:flavored-waters',
        ],
      });
      expect(result?.plainWater).toEqual({
        state: 'absent',
        sourceIds: [SOURCE],
      });
    });

    it('is absent for a soda', () => {
      const result = beverage({
        categories_tags: ['en:beverages', 'en:sodas'],
      });
      expect(result?.plainWater).toEqual({
        state: 'absent',
        sourceIds: [SOURCE],
      });
    });

    it('is absent when the water contains an included sweetener', () => {
      const result = beverage({
        categories_tags: ['en:spring-waters'],
        ingredients: [WATER, ingredient('en:e955')],
      });
      expect(result?.plainWater).toEqual({
        state: 'absent',
        sourceIds: [SOURCE],
      });
      expect(result?.nonNutritiveSweetener.state).toBe('present');
    });

    it('stays unknown for a beverage with no water or drink-type tag', () => {
      const result = beverage({ categories_tags: ['en:beverages'] });
      expect(result?.plainWater).toEqual({ state: 'unknown' });
    });

    it('is never inferred from zero energy', () => {
      const result = beverage({
        categories_tags: ['en:beverages'],
        nutriments: { 'energy-kj_100g': 0 },
      });
      expect(result?.plainWater).toEqual({ state: 'unknown' });
    });
  });

  describe('non-nutritive sweetener', () => {
    it.each(['en:e951', 'en:e955', 'en:e954i', 'en:e960a'])(
      'is present for included sweetener %s',
      (id) => {
        const result = facts({
          categories_tags: ['en:sodas'],
          ingredients: [WATER, ingredient(id)],
        });
        expect(result?.nonNutritiveSweetener.state).toBe('present');
      },
    );

    it('is present even when other ingredients are unrecognised', () => {
      const result = facts({
        categories_tags: ['en:sodas'],
        ingredients: [
          ingredient('en:e951'),
          ingredient('en:garbled', { is_in_taxonomy: 0 }),
        ],
      });
      expect(result?.nonNutritiveSweetener.state).toBe('present');
    });

    it.each(['en:e960c', 'en:e968', 'en:e420'])(
      'cannot prove sweetener absence merely from excluded %s',
      (id) => {
        const result = facts({
          categories_tags: ['en:sodas'],
          ingredients: [WATER, ingredient(id)],
        });
        expect(result?.nonNutritiveSweetener).toEqual({ state: 'unknown' });
      },
    );

    it('stays unknown for unspecified steviol glycosides (en:e960)', () => {
      const result = facts({
        categories_tags: ['en:sodas'],
        ingredients: [WATER, ingredient('en:e960')],
      });
      expect(result?.nonNutritiveSweetener).toEqual({ state: 'unknown' });
    });

    it('stays unknown with no ingredient list', () => {
      const result = facts({ categories_tags: ['en:sodas'] });
      expect(result?.nonNutritiveSweetener).toEqual({ state: 'unknown' });
    });

    it('stays unknown when an ingredient is not recognised', () => {
      const result = facts({
        categories_tags: ['en:sodas'],
        ingredients: [WATER, ingredient('en:x', { is_in_taxonomy: 0 })],
      });
      expect(result?.nonNutritiveSweetener).toEqual({ state: 'unknown' });
    });

    it('ignores malformed ingredient entries instead of trusting them', () => {
      const result = facts({
        categories_tags: ['en:sodas'],
        ingredients: [WATER, null as unknown as OffIngredientV3],
      });
      expect(result?.nonNutritiveSweetener).toEqual({ state: 'unknown' });
    });
  });

  describe('category provenance and omission', () => {
    it('cites OFF for a resolved category', () => {
      expect(
        facts({ categories_tags: ['en:biscuits'] })?.categorySourceIds,
      ).toEqual([SOURCE]);
    });

    it('omits the facts object when nothing is supported', () => {
      expect(deriveScoringFacts({}, 'unknown', SOURCE)).toBeUndefined();
    });
  });
});

describe('mapOffProductToSnapshot with scoring facts', () => {
  it.each([
    ['en:beverages', 'en:teas'],
    ['en:milks', 'en:milk-powders'],
    ['en:beverages', 'en:dehydrated-beverages'],
    ['en:beverages', 'en:instant-beverages'],
    ['en:beverages', 'en:coffee-beans'],
    ['en:beverages', 'en:tea-leaves'],
  ])(
    'does not let generic ancestors override preparation tags (%j)',
    (...tags) => {
      const snapshot = mapOffProductToSnapshot(
        '0000000000000',
        { categories_tags: tags },
        { capturedAt: '2026-10-18T00:00:00.000Z' },
      );
      expect(snapshot.category).toBe('unknown');
      expect(snapshot.scoringFacts?.categorySourceIds ?? []).toEqual([]);
    },
  );
  it.each([
    'en:organic-products',
    'en:made-up-food',
    'en:teas',
    'en:coffees',
    'en:beverages-and-beverages-preparations',
  ])(
    'does not turn unsupported route tag %s into a category assertion',
    (tag) => {
      const snapshot = mapOffProductToSnapshot(
        '0000000000000',
        { categories_tags: [tag] },
        { capturedAt: '2026-10-18T00:00:00.000Z' },
      );
      expect(snapshot.category).toBe('unknown');
      expect(snapshot.scoringFacts?.categorySourceIds ?? []).toEqual([]);
    },
  );
  it.each([undefined, 'salt, water', 'salt, water, sweetener: ...'])(
    'never equates term recognition with complete source text (%s)',
    (ingredients_text) => {
      const result = facts({
        categories_tags: ['en:biscuits'],
        ingredients_text,
        ingredients: [ingredient('en:salt'), WATER],
      });
      expect(result.cheese.state).toBe('unknown');
      expect(result.redMeat.state).toBe('unknown');
      expect(result.nonNutritiveSweetener.state).toBe('unknown');
    },
  );
  it.each(['en:cyclamate', 'en:sodium-cyclamate'])(
    'recognises pinned ingredient sweetener identity %s',
    (id) => {
      expect(
        facts(
          { categories_tags: ['en:sodas'], ingredients: [ingredient(id)] },
          'beverage',
        ).nonNutritiveSweetener.state,
      ).toBe('present');
    },
  );
  it('does not invent an included suffix identity from a regex', () => {
    expect(
      facts(
        {
          categories_tags: ['en:sodas'],
          ingredients: [ingredient('en:e951iii')],
        },
        'beverage',
      ).nonNutritiveSweetener.state,
    ).toBe('unknown');
  });
  it('produces snapshots the local contract accepts for every route', () => {
    const products: [string, OffProductV3][] = [
      ['cheese', { categories_tags: ['en:cheeses'] }],
      ['beef', { categories_tags: ['en:meats', 'en:beef'] }],
      [
        'water',
        { categories_tags: ['en:beverages', 'en:waters', 'en:spring-waters'] },
      ],
      [
        'diet soda',
        {
          categories_tags: ['en:beverages', 'en:sodas'],
          ingredients: [WATER, ingredient('en:e951')],
        },
      ],
      ['unknown', {}],
    ];
    for (const [name, product] of products) {
      const snapshot = mapOffProductToSnapshot('0000000000000', product, {
        capturedAt: '2026-10-17T00:00:00.000Z',
      });
      expect([name, localValidators.ProductSnapshot(snapshot)]).toEqual([
        name,
        true,
      ]);
    }
  });

  it('keeps fact sources pointing at the product source', () => {
    const snapshot = mapOffProductToSnapshot(
      '0000000000000',
      { categories_tags: ['en:cheeses'] },
      { capturedAt: '2026-10-17T00:00:00.000Z' },
    );
    const ids = new Set(snapshot.sourceRefs.map((source) => source.id));
    expect(snapshot.scoringFacts?.cheese).toEqual({
      state: 'present',
      sourceIds: [SOURCE],
    });
    expect(ids.has(SOURCE)).toBe(true);
  });
});
