/**
 * @jest-environment node
 */
/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localValidators } from '../../domain/contracts';
import {
  mapOffProductToSnapshot,
  resolveCategory,
  resolveMarket,
} from './off-mapper';
import {
  DEFAULT_EVIDENCE_VERSION,
  DEFAULT_TAXONOMY_VERSION,
  type OffProductV3,
  type OffResponseV3,
} from './types';

const fixturesDir = join(__dirname, '__fixtures__');

function loadFixture(barcode: string): OffResponseV3 {
  const filePath = join(fixturesDir, `${barcode}.json`);
  const text = readFileSync(filePath, 'utf8');
  return JSON.parse(text) as OffResponseV3;
}

const CANONICAL_NUTRIENT_FIELDS = new Set([
  'energy',
  'sugars',
  'saturates',
  'salt',
  'protein',
  'fibre',
  'fat',
  'fvl',
]);

describe('Open Food Facts Mapper (off-mapper.ts)', () => {
  describe('category and market resolution', () => {
    it('identifies beverage categories', () => {
      expect(resolveCategory(['en:beverages'])).toBe('beverage');
      expect(resolveCategory(['en:fruit-juices'])).toBe('beverage');
      expect(resolveCategory(['en:plant-based-beverages'])).toBe('beverage');
      expect(resolveCategory(['en:plant-milks'])).toBe('unknown');
    });

    it('identifies fats, nuts, and seeds categories', () => {
      expect(resolveCategory(['en:vegetable-oils'])).toBe('fats_nuts_seeds');
      expect(resolveCategory(['en:nuts'])).toBe('fats_nuts_seeds');
    });

    it('identifies excluded categories', () => {
      expect(resolveCategory(['en:infant-formulas'])).toBe('excluded');
      expect(resolveCategory(['en:alcoholic-beverages'])).toBe('excluded');
    });

    it('requires known route evidence and keeps unknown or empty tags unknown', () => {
      expect(resolveCategory(['en:biscuits'])).toBe('general');
      expect(resolveCategory([])).toBe('unknown');
      expect(resolveCategory(undefined)).toBe('unknown');
    });

    it('resolves market according to Indian priority and EU membership (UK and Switzerland are not EU)', () => {
      expect(resolveMarket(['en:india'])).toBe('IN');
      expect(resolveMarket(['en:india', 'en:france'])).toBe('IN'); // India priority
      expect(resolveMarket(['en:france'])).toBe('EU');
      expect(resolveMarket(['en:germany'])).toBe('EU');
      expect(resolveMarket(['en:united-kingdom'])).toBe('unknown'); // UK is strictly non-EU
      expect(resolveMarket(['en:switzerland'])).toBe('unknown'); // Switzerland is strictly non-EU
      expect(resolveMarket(['en:united-states'])).toBe('unknown');
      expect(resolveMarket([])).toBe('unknown');
    });
  });

  describe('real product fixtures (ODbL compliance & contract validation)', () => {
    it('maps Britannia Milk Bikis (8901063012493 - Indian biscuit with missing salt)', () => {
      const fixture = loadFixture('8901063012493');
      expect(fixture.product).toBeDefined();

      const snapshot = mapOffProductToSnapshot(
        '8901063012493',
        fixture.product!,
      );

      expect(snapshot.id).toBe('off:8901063012493');
      expect(snapshot.barcode).toBe('8901063012493');
      expect(snapshot.market).toBe('IN');
      expect(snapshot.category).toBe('general');
      expect(snapshot.name).toBe('Milk Bikis biscuits');

      // Check SourceRef provenance and ODbL attribution
      expect(snapshot.sourceRefs).toHaveLength(1);
      const source = snapshot.sourceRefs[0];
      expect(source?.kind).toBe('off');
      expect(source?.title).toBe('Open Food Facts product');
      expect(source?.edition).toBe('rev-8');
      expect(source?.url).toBe(
        'https://world.openfoodfacts.org/product/8901063012493',
      );
      expect(source?.locator).toContain('Open Food Facts contributors');
      expect(source?.locator).toContain('ODbL');

      // Observations check
      for (const obs of snapshot.observations) {
        expect(CANONICAL_NUTRIENT_FIELDS.has(obs.field)).toBe(true);
        if (obs.field === 'fvl') {
          // FVL from ingredients estimate must be mapped as estimated
          expect(obs.kind).toBe('estimated');
          if (obs.kind === 'estimated') {
            expect(obs.modelId).toBe('openfoodfacts-ingredients-analysis');
            expect(obs.modelVersion).toBe('fruits-vegetables-legumes-estimate');
          }
        } else {
          expect(obs.kind).toBe('read');
          if (obs.kind === 'read') {
            expect(obs.basis).toBe('per_100_g');
            expect(typeof obs.value).toBe('number');
            expect(Number.isFinite(obs.value)).toBe(true);
          }
        }
      }

      // In Milk Bikis, salt is missing in OFF nutriments. Verify missing nutrient is NOT present and NOT zero!
      const saltObs = snapshot.observations.find((o) => o.field === 'salt');
      expect(saltObs).toBeUndefined();

      // Sugars and saturates are present
      const sugarsObs = snapshot.observations.find((o) => o.field === 'sugars');
      expect(sugarsObs).toBeDefined();
      if (sugarsObs && sugarsObs.kind === 'read') {
        expect(sugarsObs.value).toBe(27);
        expect(sugarsObs.unit).toBe('g');
      }

      const satObs = snapshot.observations.find((o) => o.field === 'saturates');
      expect(satObs).toBeDefined();
      if (satObs && satObs.kind === 'read') {
        expect(satObs.value).toBe(6);
        expect(satObs.unit).toBe('g');
      }

      // Panels check
      expect(snapshot.panels).toHaveLength(2);
      const ingPanel = snapshot.panels.find((p) => p.panel === 'ingredients');
      expect(ingPanel?.state).toBe('read');
      expect(ingPanel?.text).toContain('Refined Wheat Flour');

      const nutPanel = snapshot.panels.find((p) => p.panel === 'nutrition');
      expect(nutPanel?.state).toBe('read');

      // Ingredients check: nested tree preserved, parentId linked, unresolved state
      const flour = snapshot.ingredients.find((i) =>
        i.text.includes('Refined Wheat Flour'),
      );
      const maida = snapshot.ingredients.find((i) => i.text.includes('Maida'));
      expect(flour).toBeDefined();
      expect(maida).toBeDefined();
      expect(maida?.parentId).toBe(flour?.id);
      expect(maida?.state).toBe('unresolved');
      expect(maida?.canonicalId).toBeNull();
      expect(maida?.candidateIds).toEqual([]);

      // Passes contract validator
      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });

    it('maps Amul Taaza Toned Milk (8901262260091 - Indian beverage with per_100_ml basis)', () => {
      const fixture = loadFixture('8901262260091');
      const snapshot = mapOffProductToSnapshot(
        '8901262260091',
        fixture.product!,
      );

      expect(snapshot.barcode).toBe('8901262260091');
      expect(snapshot.market).toBe('IN');
      expect(snapshot.category).toBe('beverage');

      // Crucial: Basis must be per_100_ml when nutrition_data_per specifies 100ml
      for (const obs of snapshot.observations) {
        if (obs.kind === 'read') {
          expect(obs.basis).toBe('per_100_ml');
        }
      }

      const proteinObs = snapshot.observations.find(
        (o) => o.field === 'protein',
      );
      expect(proteinObs).toBeDefined();
      if (proteinObs && proteinObs.kind === 'read') {
        expect(proteinObs.value).toBe(3);
        expect(proteinObs.unit).toBe('g');
      }

      const saltObs = snapshot.observations.find((o) => o.field === 'salt');
      expect(saltObs).toBeDefined();
      if (saltObs && saltObs.kind === 'read') {
        expect(saltObs.value).toBe(0.1);
      }

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });

    it('maps Apollo Life Arabian Dates (8904355407762 - missing saturates and empty ingredients_text)', () => {
      const fixture = loadFixture('8904355407762');
      const snapshot = mapOffProductToSnapshot(
        '8904355407762',
        fixture.product!,
      );

      expect(snapshot.market).toBe('IN');
      // Saturates is missing in Dates nutriments: verify never zeroed
      expect(
        snapshot.observations.find((o) => o.field === 'saturates'),
      ).toBeUndefined();

      // Fibre is present: 6.26g
      const fibreObs = snapshot.observations.find((o) => o.field === 'fibre');
      expect(fibreObs).toBeDefined();
      if (fibreObs && fibreObs.kind === 'read') {
        expect(fibreObs.value).toBe(6.26);
      }

      // Ingredients text was empty in OFF -> panel marked missing with retake action
      const ingPanel = snapshot.panels.find((p) => p.panel === 'ingredients');
      expect(ingPanel?.state).toBe('missing');
      expect(ingPanel?.issues[0]?.code).toBe('ingredients_missing');
      expect(ingPanel?.issues[0]?.action).toBe('retake');

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });

    it('maps Maggi 2-Minute Noodles (8901058005578 - missing nutriments/empty facts)', () => {
      const fixture = loadFixture('8901058005578');
      const snapshot = mapOffProductToSnapshot(
        '8901058005578',
        fixture.product!,
      );

      expect(snapshot.observations).toEqual([]);
      const nutPanel = snapshot.panels.find((p) => p.panel === 'nutrition');
      expect(nutPanel?.state).toBe('missing');
      expect(nutPanel?.issues[0]?.code).toBe('nutrition_missing');

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });

    it('maps Nutella (3017624010701 - European product with complete nutrients and revision 113)', () => {
      const fixture = loadFixture('3017624010701');
      const snapshot = mapOffProductToSnapshot(
        '3017624010701',
        fixture.product!,
      );

      expect(snapshot.market).toBe('EU');
      expect(snapshot.sourceRefs[0]?.edition).toBe('rev-113');

      // Nutella has energy in kJ: 2228
      const energyObs = snapshot.observations.find((o) => o.field === 'energy');
      expect(energyObs).toBeDefined();
      if (energyObs && energyObs.kind === 'read') {
        expect(energyObs.value).toBe(2228);
        expect(energyObs.unit).toBe('kJ');
      }

      // Fat is 30.9
      const fatObs = snapshot.observations.find((o) => o.field === 'fat');
      expect(fatObs).toBeDefined();
      if (fatObs && fatObs.kind === 'read') {
        expect(fatObs.value).toBe(30.9);
      }

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });
  });

  describe('nutrient conversions and derivations', () => {
    it('converts kcal to kJ when only kcal is present, recording traceable derivation and primary citation', () => {
      const syntheticProduct: OffProductV3 = {
        code: '8901234567890',
        nutriments: {
          'energy-kcal_100g': 100, // 100 kcal = 418.4 kJ
        },
      };

      const snapshot = mapOffProductToSnapshot(
        '8901234567890',
        syntheticProduct,
      );
      const energyObs = snapshot.observations.find((o) => o.field === 'energy');
      expect(energyObs).toBeDefined();
      if (energyObs && energyObs.kind === 'read') {
        expect(energyObs.unit).toBe('kJ');
        expect(energyObs.value).toBe(418.4);
        expect(energyObs.derivation).toEqual([
          'energy_from_kcal: kcal * 4.184',
          'citation: FAO Food and Nutrition Paper 77 (2003), section 3.1 (1 kcal = 4.184 kJ); https://www.fao.org/4/y5022e/y5022e04.htm',
        ]);
      }

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });

    it('converts sodium to salt when only sodium is present, recording traceable derivation and primary citation', () => {
      const syntheticProduct: OffProductV3 = {
        code: '8901234567890',
        nutriments: {
          sodium_100g: 0.4, // 0.4 * 2.5 = 1.0 g salt
        },
      };

      const snapshot = mapOffProductToSnapshot(
        '8901234567890',
        syntheticProduct,
      );
      const saltObs = snapshot.observations.find((o) => o.field === 'salt');
      expect(saltObs).toBeDefined();
      if (saltObs && saltObs.kind === 'read') {
        expect(saltObs.unit).toBe('g');
        expect(saltObs.value).toBe(1.0);
        expect(saltObs.derivation).toEqual([
          'salt_from_sodium: sodium * 2.5',
          'citation: Regulation (EU) No 1169/2011 Annex I(11) (salt = sodium * 2.5)',
        ]);
      }

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });
  });

  describe('Defect 1 Regressions: Nutrient basis correctness and density avoidance', () => {
    it('maps serving-based nutriments with basis "per_serving" rather than "per_100_g"', () => {
      const servingProduct: OffProductV3 = {
        code: '8901234567890',
        nutrition_data_per: 'serving',
        nutriments: {
          sugars: 5,
          fat: 2,
        },
      };

      const snapshot = mapOffProductToSnapshot('8901234567890', servingProduct);
      const sugarsObs = snapshot.observations.find((o) => o.field === 'sugars');
      const fatObs = snapshot.observations.find((o) => o.field === 'fat');

      expect(sugarsObs).toBeDefined();
      expect(sugarsObs?.kind).toBe('read');
      if (sugarsObs && sugarsObs.kind === 'read') {
        expect(sugarsObs.basis).toBe('per_serving');
        expect(sugarsObs.value).toBe(5);
      }

      expect(fatObs).toBeDefined();
      expect(fatObs?.kind).toBe('read');
      if (fatObs && fatObs.kind === 'read') {
        expect(fatObs.basis).toBe('per_serving');
        expect(fatObs.value).toBe(2);
      }

      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    });

    it('does not allow beverage category or volume unit to override explicit nutrition_data_per "100g"', () => {
      const beverageWith100g: OffProductV3 = {
        code: '8901234567890',
        categories_tags: ['en:beverages'],
        product_quantity_unit: 'ml',
        nutrition_data_per: '100g',
        nutriments: {
          sugars_100g: 8,
        },
      };

      const snapshot = mapOffProductToSnapshot(
        '8901234567890',
        beverageWith100g,
      );
      const sugarsObs = snapshot.observations.find((o) => o.field === 'sugars');
      expect(sugarsObs).toBeDefined();
      expect(sugarsObs?.kind).toBe('read');
      if (sugarsObs && sugarsObs.kind === 'read') {
        expect(sugarsObs.basis).toBe('per_100_g'); // Must NOT be overridden to per_100_ml
      }
    });

    it('omits unsuffixed nutrients when nutrition_data_per is missing to avoid guessing basis or density', () => {
      const ambiguousProduct: OffProductV3 = {
        code: '8901234567890',
        nutriments: {
          sugars: 12, // unsuffixed without nutrition_data_per declaration
        },
      };

      const snapshot = mapOffProductToSnapshot(
        '8901234567890',
        ambiguousProduct,
      );
      const sugarsObs = snapshot.observations.find((o) => o.field === 'sugars');
      expect(sugarsObs).toBeUndefined(); // Cannot verify basis without guessing, omitted safely
    });
  });

  describe('Defect 2 Regressions: Estimated facts, FVL exclusions, and provenance', () => {
    it('ignores legacy fruits-vegetables-nuts-estimate and emits estimated kind for legumes estimate', () => {
      const legacyNutsProduct: OffProductV3 = {
        code: '8901234567890',
        nutriments: {
          'fruits-vegetables-nuts-estimate_100g': 45, // Legacy 2017 Nutri-Score, MUST NOT map to updated FVL
        },
      };

      const snapshot1 = mapOffProductToSnapshot(
        '8901234567890',
        legacyNutsProduct,
      );
      expect(
        snapshot1.observations.find((o) => o.field === 'fvl'),
      ).toBeUndefined();

      const legumeProduct: OffProductV3 = {
        code: '8901234567890',
        nutriments: {
          'fruits-vegetables-legumes-estimate_100g': 60,
        },
      };

      const snapshot2 = mapOffProductToSnapshot('8901234567890', legumeProduct);
      const fvlObs = snapshot2.observations.find((o) => o.field === 'fvl');
      expect(fvlObs).toBeDefined();
      expect(fvlObs?.kind).toBe('estimated');
      if (fvlObs && fvlObs.kind === 'estimated') {
        expect(fvlObs.value).toBe(60);
        expect(fvlObs.modelId).toBe('openfoodfacts-ingredients-analysis');
        expect(fvlObs.modelVersion).toBe('fruits-vegetables-legumes-estimate');
      }
    });

    it('uses last_modified_t or retrieved timestamp when rev is missing, never inventing rev-1', () => {
      const noRevProduct: OffProductV3 = {
        code: '8901234567890',
        last_modified_t: 1710000000,
      };

      const snapshot1 = mapOffProductToSnapshot('8901234567890', noRevProduct);
      expect(snapshot1.sourceRefs[0]?.edition).toBe('t-1710000000');

      const noTimestampProduct: OffProductV3 = {
        code: '8901234567890',
      };

      const snapshot2 = mapOffProductToSnapshot(
        '8901234567890',
        noTimestampProduct,
        { capturedAt: '2026-10-16T12:00:00.000Z' },
      );
      expect(snapshot2.sourceRefs[0]?.edition).toBe(
        'retrieved-2026-10-16T12:00:00.000Z',
      );
    });

    it('defaults taxonomyVersion and evidenceVersion to pinned manifest defaults', () => {
      const product: OffProductV3 = { code: '8901234567890' };
      const snapshot = mapOffProductToSnapshot('8901234567890', product);

      expect(snapshot.taxonomyVersion).toBe(DEFAULT_TAXONOMY_VERSION);
      expect(snapshot.evidenceVersion).toBe(DEFAULT_EVIDENCE_VERSION);
    });
  });
});
