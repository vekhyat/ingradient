import { localValidators, validationDetail } from '../../domain/contracts';
import type {
  IngredientMention,
  NutrientObservation,
  PanelRegion,
  ProductSnapshot,
  SourceRef,
} from '../../domain/contracts/generated/local';
import {
  DEFAULT_EVIDENCE_VERSION,
  DEFAULT_TAXONOMY_VERSION,
  type OffIngredientV3,
  type OffProductV3,
} from './types';

const BEVERAGE_TAGS = new Set([
  'en:beverages',
  'en:beverages-and-beverages-preparations',
  'en:drinks',
  'en:waters',
  'en:milks',
  'en:milks-liquid-and-powder',
  'en:whole-milks',
  'en:fruit-juices',
  'en:fruit-nectars',
  'en:sodas',
  'en:soft-drinks',
  'en:plant-milks',
  'en:teas',
  'en:coffees',
  'en:energy-drinks',
]);

const FATS_NUTS_SEEDS_TAGS = new Set([
  'en:fats',
  'en:vegetable-fats',
  'en:vegetable-oils',
  'en:fats-and-oils',
  'en:nuts',
  'en:nuts-and-their-products',
  'en:seeds',
  'en:oilseeds',
  'en:butters',
  'en:margarines',
]);

const EXCLUDED_TAGS = new Set([
  'en:baby-foods',
  'en:infant-formulas',
  'en:alcoholic-beverages',
  'en:dietary-supplements',
]);

/**
 * Official European Union Member States (EU-27) + European Union tag.
 * Note: United Kingdom ('en:united-kingdom') and Switzerland ('en:switzerland')
 * are strictly non-EU jurisdictions.
 */
const EU_COUNTRY_TAGS = new Set([
  'en:austria',
  'en:belgium',
  'en:bulgaria',
  'en:croatia',
  'en:cyprus',
  'en:czech-republic',
  'en:denmark',
  'en:estonia',
  'en:finland',
  'en:france',
  'en:germany',
  'en:greece',
  'en:hungary',
  'en:ireland',
  'en:italy',
  'en:latvia',
  'en:lithuania',
  'en:luxembourg',
  'en:malta',
  'en:netherlands',
  'en:poland',
  'en:portugal',
  'en:romania',
  'en:slovakia',
  'en:slovenia',
  'en:spain',
  'en:sweden',
  'en:european-union',
]);

export interface MapperOptions {
  readonly taxonomyVersion?: string;
  readonly evidenceVersion?: string;
  readonly capturedAt?: string;
}

/**
 * Determines whether the product belongs to a specific category.
 */
export function resolveCategory(
  categoriesTags?: readonly string[],
): 'general' | 'fats_nuts_seeds' | 'beverage' | 'excluded' | 'unknown' {
  if (!categoriesTags || categoriesTags.length === 0) {
    return 'unknown';
  }

  for (const tag of categoriesTags) {
    if (EXCLUDED_TAGS.has(tag)) {
      return 'excluded';
    }
  }

  for (const tag of categoriesTags) {
    if (BEVERAGE_TAGS.has(tag)) {
      return 'beverage';
    }
  }

  for (const tag of categoriesTags) {
    if (FATS_NUTS_SEEDS_TAGS.has(tag)) {
      return 'fats_nuts_seeds';
    }
  }

  return 'general';
}

/**
 * Determines the target market (IN, EU, or unknown) from country tags.
 * UK and Switzerland are strictly non-EU.
 */
export function resolveMarket(
  countriesTags?: readonly string[],
): 'IN' | 'EU' | 'unknown' {
  if (!countriesTags || countriesTags.length === 0) {
    return 'unknown';
  }

  // India takes priority per ADR 001
  if (countriesTags.includes('en:india')) {
    return 'IN';
  }

  for (const tag of countriesTags) {
    if (EU_COUNTRY_TAGS.has(tag)) {
      return 'EU';
    }
  }

  return 'unknown';
}

/**
 * Maps a numeric value safely. Returns undefined if not a finite number.
 */
function extractNumeric(val: unknown): number | undefined {
  if (typeof val === 'number' && Number.isFinite(val)) {
    return val;
  }
  if (typeof val === 'string' && /^\d+(?:\.\d+)?$/.test(val.trim())) {
    const parsed = Number(val);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function validateProductMetadata(product: OffProductV3): void {
  for (const tags of [product.countries_tags, product.categories_tags]) {
    if (
      tags !== undefined &&
      (!Array.isArray(tags) ||
        !tags.every((tag: unknown) => typeof tag === 'string'))
    ) {
      throw new TypeError('Invalid Open Food Facts tag list');
    }
  }
  if (
    product.rev !== undefined &&
    (typeof product.rev !== 'number' || !Number.isFinite(product.rev))
  ) {
    throw new TypeError('Invalid Open Food Facts revision');
  }
}

interface NutrientExtraction {
  value: number;
  basis: 'per_100_g' | 'per_100_ml' | 'per_serving';
}

/**
 * Resolves a nutrient value and its authoritative basis from Open Food Facts nutriments.
 *
 * Rules:
 * - When reading from _100g fields: basis is 'per_100_ml' if nutrition_data_per === '100ml',
 *   otherwise 'per_100_g'. Category or package volume units NEVER override explicit basis.
 * - When nutrition_data_per === 'serving': unsuffixed and _serving fields are 'per_serving'.
 * - When nutrition_data_per is omitted or unknown: unsuffixed fields are NOT assumed to be per 100g,
 *   preventing density or basis misattribution.
 */
function resolveNutrient(
  nutriments: Record<string, unknown>,
  key100g: string,
  unsuffixedKey: string,
  servingKey: string,
  nutritionDataPer: string | undefined,
  per100Basis: 'per_100_g' | 'per_100_ml',
): NutrientExtraction | undefined {
  // 1. Explicit 100g/100ml field
  const val100g = extractNumeric(nutriments[key100g]);
  if (val100g !== undefined) {
    return { value: val100g, basis: per100Basis };
  }

  // 2. Authoritative basis declaration on package
  if (nutritionDataPer === '100g' || nutritionDataPer === '100ml') {
    const valUnsuffixed = extractNumeric(nutriments[unsuffixedKey]);
    if (valUnsuffixed !== undefined) {
      return { value: valUnsuffixed, basis: per100Basis };
    }
  } else if (nutritionDataPer === 'serving') {
    const valServing =
      extractNumeric(nutriments[servingKey]) ??
      extractNumeric(nutriments[unsuffixedKey]);
    if (valServing !== undefined) {
      return { value: valServing, basis: 'per_serving' };
    }
  }

  // 3. Explicit serving field even if nutritionDataPer is absent
  const valExplicitServing = extractNumeric(nutriments[servingKey]);
  if (valExplicitServing !== undefined) {
    return { value: valExplicitServing, basis: 'per_serving' };
  }

  // Unresolvable: never infer density or guess basis for unsuffixed fields
  return undefined;
}

/**
 * Maps raw Open Food Facts v3 product facts into a local contract ProductSnapshot.
 *
 * Adheres to:
 * - Only nutrients actually present (missing nutrients are never defaulted to zero).
 * - Exact canonical nutrient field names from Nutri-Score 2023 inputFields:
 *   energy, sugars, saturates, salt, protein, fibre, fat, fvl.
 * - Preserves authoritative basis ('per_100_g', 'per_100_ml', or 'per_serving') without density guessing.
 * - Legume-specific FVL with kind: 'estimated' (never legacy nuts estimate as updated FVL).
 * - Primary citations for conversions:
 *   FAO Food and Nutrition Paper 77 (2003), section 3.1 for kcal -> kJ.
 *   https://www.fao.org/4/y5022e/y5022e04.htm
 *   Regulation (EU) No 1169/2011 Annex I(11) for sodium -> salt.
 * - Real pinned edition inputs from manifest and retrieved-time provenance when revision is absent (no invented rev-1).
 * - Unresolved ingredient mentions unless verified against pinned taxonomy; preserves nested ingredient hierarchy.
 * - Schema validation via precompiled local contract validator.
 */
export function mapOffProductToSnapshot(
  barcode: string,
  product: OffProductV3,
  options?: MapperOptions,
): ProductSnapshot {
  validateProductMetadata(product);
  const taxonomyVersion = options?.taxonomyVersion ?? DEFAULT_TAXONOMY_VERSION;
  const evidenceVersion = options?.evidenceVersion ?? DEFAULT_EVIDENCE_VERSION;
  const capturedAt = options?.capturedAt ?? new Date().toISOString();

  const sourceRefId = `off:${barcode}`;

  // Revision provenance: use product.rev, else product.last_modified_t, else retrieved timestamp.
  // Never invent rev-1.
  let edition: string;
  if (
    typeof product.rev === 'number' &&
    Number.isFinite(product.rev) &&
    product.rev > 0
  ) {
    edition = `rev-${product.rev}`;
  } else if (
    typeof product.last_modified_t === 'number' &&
    Number.isFinite(product.last_modified_t) &&
    product.last_modified_t > 0
  ) {
    edition = `t-${product.last_modified_t}`;
  } else {
    edition = `retrieved-${capturedAt}`;
  }

  const sourceRef: SourceRef = {
    id: sourceRefId,
    kind: 'off',
    title: 'Open Food Facts product',
    edition,
    url: `https://world.openfoodfacts.org/product/${barcode}`,
    locator: 'ODbL 1.0; Open Food Facts contributors',
  };

  const category = resolveCategory(product.categories_tags);
  const market = resolveMarket(product.countries_tags);

  // Authoritative per-100 basis:
  // Strictly 'per_100_ml' only if nutrition_data_per is explicitly '100ml'.
  // If nutrition_data_per is '100g' or not specified, defaults to 'per_100_g'.
  // Category or package quantity units MUST NOT override explicit basis.
  const per100Basis: 'per_100_g' | 'per_100_ml' =
    product.nutrition_data_per === '100ml' ? 'per_100_ml' : 'per_100_g';

  const nutriments = product.nutriments ?? {};
  const observations: NutrientObservation[] = [];

  // 1. Energy (canonical unit: kJ)
  const energyKjExtraction = ((): NutrientExtraction | undefined => {
    // Check explicit kJ 100g field
    const kj100 =
      extractNumeric(nutriments['energy-kj_100g']) ??
      (nutriments.energy_unit === 'kJ'
        ? extractNumeric(nutriments.energy_100g)
        : undefined);
    if (kj100 !== undefined) {
      return { value: kj100, basis: per100Basis };
    }

    if (
      product.nutrition_data_per === '100g' ||
      product.nutrition_data_per === '100ml'
    ) {
      const kjUnsuffixed =
        extractNumeric(nutriments['energy-kj']) ??
        (nutriments.energy_unit === 'kJ'
          ? extractNumeric(nutriments.energy)
          : undefined);
      if (kjUnsuffixed !== undefined) {
        return { value: kjUnsuffixed, basis: per100Basis };
      }
    } else if (product.nutrition_data_per === 'serving') {
      const kjServing =
        extractNumeric(nutriments['energy-kj_serving']) ??
        extractNumeric(nutriments['energy-kj']) ??
        (nutriments.energy_unit === 'kJ'
          ? (extractNumeric(nutriments.energy_serving) ??
            extractNumeric(nutriments.energy))
          : undefined);
      if (kjServing !== undefined) {
        return { value: kjServing, basis: 'per_serving' };
      }
    }

    const kjExplicitServing =
      extractNumeric(nutriments['energy-kj_serving']) ??
      (nutriments.energy_unit === 'kJ'
        ? extractNumeric(nutriments.energy_serving)
        : undefined);
    if (kjExplicitServing !== undefined) {
      return { value: kjExplicitServing, basis: 'per_serving' };
    }

    return undefined;
  })();

  if (energyKjExtraction !== undefined) {
    observations.push({
      field: 'energy',
      kind: 'read',
      value: energyKjExtraction.value,
      unit: 'kJ',
      basis: energyKjExtraction.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  } else {
    // Fall back to energy-kcal converted to kJ (1 kcal = 4.184 kJ)
    // Primary citation: FAO Food and Nutrition Paper 77 (2003), section 3.1
    // https://www.fao.org/4/y5022e/y5022e04.htm
    const energyKcalExtraction = ((): NutrientExtraction | undefined => {
      const kcal100 =
        extractNumeric(nutriments['energy-kcal_100g']) ??
        (nutriments.energy_unit === 'kcal'
          ? extractNumeric(nutriments.energy_100g)
          : undefined);
      if (kcal100 !== undefined) {
        return { value: kcal100, basis: per100Basis };
      }

      if (
        product.nutrition_data_per === '100g' ||
        product.nutrition_data_per === '100ml'
      ) {
        const kcalUnsuffixed =
          extractNumeric(nutriments['energy-kcal']) ??
          (nutriments.energy_unit === 'kcal'
            ? extractNumeric(nutriments.energy)
            : undefined);
        if (kcalUnsuffixed !== undefined) {
          return { value: kcalUnsuffixed, basis: per100Basis };
        }
      } else if (product.nutrition_data_per === 'serving') {
        const kcalServing =
          extractNumeric(nutriments['energy-kcal_serving']) ??
          extractNumeric(nutriments['energy-kcal']) ??
          (nutriments.energy_unit === 'kcal'
            ? (extractNumeric(nutriments.energy_serving) ??
              extractNumeric(nutriments.energy))
            : undefined);
        if (kcalServing !== undefined) {
          return { value: kcalServing, basis: 'per_serving' };
        }
      }

      const kcalExplicitServing =
        extractNumeric(nutriments['energy-kcal_serving']) ??
        (nutriments.energy_unit === 'kcal'
          ? extractNumeric(nutriments.energy_serving)
          : undefined);
      if (kcalExplicitServing !== undefined) {
        return { value: kcalExplicitServing, basis: 'per_serving' };
      }

      return undefined;
    })();

    if (energyKcalExtraction !== undefined) {
      const convertedKj = Number(
        (energyKcalExtraction.value * 4.184).toFixed(2),
      );
      observations.push({
        field: 'energy',
        kind: 'read',
        value: convertedKj,
        unit: 'kJ',
        basis: energyKcalExtraction.basis,
        sourceIds: [sourceRefId],
        derivation: [
          'energy_from_kcal: kcal * 4.184',
          'citation: FAO Food and Nutrition Paper 77 (2003), section 3.1 (1 kcal = 4.184 kJ); https://www.fao.org/4/y5022e/y5022e04.htm',
        ],
        issues: [],
      });
    }
  }

  // 2. Sugars (unit: g)
  const sugars = resolveNutrient(
    nutriments,
    'sugars_100g',
    'sugars',
    'sugars_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  if (sugars !== undefined) {
    observations.push({
      field: 'sugars',
      kind: 'read',
      value: sugars.value,
      unit: 'g',
      basis: sugars.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  }

  // 3. Saturates (unit: g)
  const saturates = resolveNutrient(
    nutriments,
    'saturated-fat_100g',
    'saturated-fat',
    'saturated-fat_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  if (saturates !== undefined) {
    observations.push({
      field: 'saturates',
      kind: 'read',
      value: saturates.value,
      unit: 'g',
      basis: saturates.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  }

  // 4. Salt (unit: g)
  const salt = resolveNutrient(
    nutriments,
    'salt_100g',
    'salt',
    'salt_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  if (salt !== undefined) {
    observations.push({
      field: 'salt',
      kind: 'read',
      value: salt.value,
      unit: 'g',
      basis: salt.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  } else {
    // Traceable fallback from sodium if salt is undeclared: sodium * 2.5
    // Primary citation: Regulation (EU) No 1169/2011 Annex I(11)
    const sodium = resolveNutrient(
      nutriments,
      'sodium_100g',
      'sodium',
      'sodium_serving',
      product.nutrition_data_per,
      per100Basis,
    );
    if (sodium !== undefined) {
      const convertedSalt = Number((sodium.value * 2.5).toFixed(4));
      observations.push({
        field: 'salt',
        kind: 'read',
        value: convertedSalt,
        unit: 'g',
        basis: sodium.basis,
        sourceIds: [sourceRefId],
        derivation: [
          'salt_from_sodium: sodium * 2.5',
          'citation: Regulation (EU) No 1169/2011 Annex I(11) (salt = sodium * 2.5)',
        ],
        issues: [],
      });
    }
  }

  // 5. Protein (unit: g)
  const protein = resolveNutrient(
    nutriments,
    'proteins_100g',
    'proteins',
    'proteins_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  if (protein !== undefined) {
    observations.push({
      field: 'protein',
      kind: 'read',
      value: protein.value,
      unit: 'g',
      basis: protein.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  }

  // 6. Fibre (unit: g)
  const fibre = resolveNutrient(
    nutriments,
    'fiber_100g',
    'fiber',
    'fiber_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  if (fibre !== undefined) {
    observations.push({
      field: 'fibre',
      kind: 'read',
      value: fibre.value,
      unit: 'g',
      basis: fibre.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  }

  // 7. Fat (unit: g)
  const fat = resolveNutrient(
    nutriments,
    'fat_100g',
    'fat',
    'fat_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  if (fat !== undefined) {
    observations.push({
      field: 'fat',
      kind: 'read',
      value: fat.value,
      unit: 'g',
      basis: fat.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  }

  // 8. FVL - Fruits, Vegetables, Legumes (unit: percent)
  // Under updated Nutri-Score (2023), FVL specifically includes legumes and excludes nuts
  // (nuts are scored under fats/oils). Legacy nuts estimates MUST NOT be mapped to updated FVL.
  // Values derived from ingredients estimation algorithm are marked kind: 'estimated'.
  const fvlDeclared = resolveNutrient(
    nutriments,
    'fruits-vegetables-legumes_100g',
    'fruits-vegetables-legumes',
    'fruits-vegetables-legumes_serving',
    product.nutrition_data_per,
    per100Basis,
  );
  const fvlEstimated =
    resolveNutrient(
      nutriments,
      'fruits-vegetables-legumes-estimate-from-ingredients_100g',
      'fruits-vegetables-legumes-estimate-from-ingredients',
      'fruits-vegetables-legumes-estimate-from-ingredients_serving',
      product.nutrition_data_per,
      per100Basis,
    ) ??
    resolveNutrient(
      nutriments,
      'fruits-vegetables-legumes-estimate_100g',
      'fruits-vegetables-legumes-estimate',
      'fruits-vegetables-legumes-estimate_serving',
      product.nutrition_data_per,
      per100Basis,
    );

  if (fvlDeclared !== undefined) {
    observations.push({
      field: 'fvl',
      kind: 'read',
      value: fvlDeclared.value,
      unit: 'percent',
      basis: fvlDeclared.basis,
      sourceIds: [sourceRefId],
      issues: [],
    });
  } else if (fvlEstimated !== undefined) {
    observations.push({
      field: 'fvl',
      kind: 'estimated',
      value: fvlEstimated.value,
      unit: 'percent',
      basis: fvlEstimated.basis,
      sourceIds: [sourceRefId],
      issues: [],
      modelId: 'openfoodfacts-ingredients-analysis',
      modelVersion: 'fruits-vegetables-legumes-estimate',
    });
  }

  // Map Panels
  const ingredientsText = (
    product.ingredients_text ??
    product.ingredients_text_en ??
    ''
  ).trim();

  const panels: PanelRegion[] = [];

  // Ingredients panel
  if (ingredientsText.length > 0) {
    panels.push({
      panel: 'ingredients',
      state: 'read',
      text: ingredientsText,
      imageId: null,
      regionId: null,
      issues: [],
    });
  } else {
    panels.push({
      panel: 'ingredients',
      state: 'missing',
      imageId: null,
      regionId: null,
      issues: [
        {
          code: 'ingredients_missing',
          stage: 'extraction',
          field: 'ingredients',
          message: 'Ingredients text not available on Open Food Facts',
          action: 'retake',
        },
      ],
    });
  }

  // Nutrition panel
  if (observations.length > 0) {
    panels.push({
      panel: 'nutrition',
      state: 'read',
      imageId: null,
      regionId: null,
      issues: [],
    });
  } else {
    panels.push({
      panel: 'nutrition',
      state: 'missing',
      imageId: null,
      regionId: null,
      issues: [
        {
          code: 'nutrition_missing',
          stage: 'extraction',
          field: 'nutrition',
          message: 'Nutrition facts not available on Open Food Facts',
          action: 'retake',
        },
      ],
    });
  }

  // Map ingredients preserving nested hierarchy (max 300).
  // Upstream OFF IDs remain unresolved until verified against pinned taxonomy (MAT-01).
  const ingredients: IngredientMention[] = [];

  function traverseIngredients(
    rawList: readonly OffIngredientV3[],
    parentId: string | null,
  ): void {
    for (const rawIng of rawList) {
      if (ingredients.length >= 300) {
        break;
      }
      if (!rawIng || typeof rawIng !== 'object') {
        continue;
      }
      const rawText = (rawIng.text ?? rawIng.id ?? '').trim().slice(0, 2000);
      if (rawText.length === 0) {
        continue;
      }
      const mentionId = `off-ing-${barcode}-${ingredients.length}`;
      ingredients.push({
        id: mentionId,
        text: rawText,
        parentId,
        canonicalId: null,
        state: 'unresolved',
        candidateIds: [],
        sourceIds: [sourceRefId],
        taxonomyVersion,
      });

      if (Array.isArray(rawIng.ingredients) && rawIng.ingredients.length > 0) {
        traverseIngredients(rawIng.ingredients, mentionId);
      }
    }
  }

  if (Array.isArray(product.ingredients)) {
    traverseIngredients(product.ingredients, null);
  }

  const name =
    product.product_name?.trim() ||
    product.product_name_en?.trim() ||
    product.brands?.trim() ||
    null;

  const snapshot: ProductSnapshot = {
    id: `off:${barcode}`,
    barcode,
    name,
    market,
    capturedAt,
    sourceRefs: [sourceRef],
    observations,
    ingredients,
    panels,
    category,
    taxonomyVersion,
    evidenceVersion,
  };

  const validator = localValidators.ProductSnapshot;
  if (!validator(snapshot)) {
    const detail = validationDetail(validator);
    throw new Error(`ProductSnapshot failed contract validation: ${detail}`);
  }

  return snapshot;
}
