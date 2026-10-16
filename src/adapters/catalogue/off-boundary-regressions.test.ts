/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import { createCatalogueAdapter } from './off-adapter';
import { mapOffProductToSnapshot } from './off-mapper';

const BARCODE = '8901063012493';

async function lookup(payload: unknown) {
  const fetch: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  return createCatalogueAdapter({
    userAgent: 'Ingradient-Test/0.1 (catalogue regression)',
    fetch,
  }).lookupBarcode(BARCODE);
}

describe('catalogue boundary regressions', () => {
  it.each([
    { product: { product_name: 'Other product' } },
    { product: { code: 3017624010701 } },
    { code: BARCODE, product: { code: 3017624010701 } },
    { code: BARCODE, product: {} },
    { status: 0, product: {} },
    { product: { code: '' } },
    { code: '3017624010701', product: { code: BARCODE } },
    { code: 8901063012493, product: { code: BARCODE } },
  ])('rejects an unverified product identity: %j', async (payload) => {
    expect(await lookup(payload)).toMatchObject({ state: 'malformed' });
  });

  it.each([BARCODE, '08901063012493'])(
    'accepts the verified product code %s',
    async (code) => {
      expect(await lookup({ product: { code } })).toMatchObject({
        state: 'found',
        snapshot: { barcode: BARCODE },
      });
    },
  );

  it.each([
    { countries_tags: 'en:france' },
    { countries_tags: 'en:india' },
    { countries_tags: ['en:france', 7] },
    { categories_tags: 'en:beverages' },
    { categories_tags: ['en:beverages', null] },
    { rev: '113' },
    { rev: null },
  ])('rejects malformed product metadata: %j', async (metadata) => {
    expect(
      await lookup({ product: { code: BARCODE, ...metadata } }),
    ).toMatchObject({ state: 'malformed' });
  });

  it('preserves valid market/category tags and revision provenance', async () => {
    expect(
      await lookup({
        product: {
          code: BARCODE,
          countries_tags: ['en:france'],
          categories_tags: ['en:beverages'],
          rev: 113,
        },
      }),
    ).toMatchObject({
      state: 'found',
      snapshot: {
        market: 'EU',
        category: 'beverage',
        sourceRefs: [expect.objectContaining({ edition: 'rev-113' })],
      },
    });
  });

  it.each([0, 40])(
    'keeps declared fruit/vegetable/legume content %s ahead of an estimate',
    (declared) => {
      const snapshot = mapOffProductToSnapshot(BARCODE, {
        code: BARCODE,
        nutriments: {
          'fruits-vegetables-legumes_100g': declared,
          'fruits-vegetables-legumes-estimate-from-ingredients_100g': 15,
        },
      });
      expect(snapshot.observations.filter((o) => o.field === 'fvl')).toEqual([
        expect.objectContaining({
          kind: 'read',
          value: declared,
          basis: 'per_100_g',
        }),
      ]);
    },
  );

  it('keeps an estimate of zero when no declared value exists', () => {
    const snapshot = mapOffProductToSnapshot(BARCODE, {
      code: BARCODE,
      nutriments: {
        'fruits-vegetables-legumes-estimate-from-ingredients_100g': 0,
      },
    });
    expect(snapshot.observations.filter((o) => o.field === 'fvl')).toEqual([
      expect.objectContaining({ kind: 'estimated', value: 0 }),
    ]);
  });

  it.each(['0x10', '0b10', '1e2'])(
    'does not turn the non-decimal string %s into a measured nutrient',
    (sugars) => {
      const snapshot = mapOffProductToSnapshot(BARCODE, {
        code: BARCODE,
        nutriments: { sugars_100g: sugars },
      });
      expect(
        snapshot.observations.find((o) => o.field === 'sugars'),
      ).toBeUndefined();
    },
  );

  it.each(['0', '12.5', ' 0.00001 '])(
    'preserves the plain decimal string %s',
    (sugars) => {
      const snapshot = mapOffProductToSnapshot(BARCODE, {
        code: BARCODE,
        nutriments: { sugars_100g: sugars },
      });
      expect(
        snapshot.observations.find((o) => o.field === 'sugars'),
      ).toMatchObject({
        kind: 'read',
        value: Number(sugars),
      });
    },
  );
});
