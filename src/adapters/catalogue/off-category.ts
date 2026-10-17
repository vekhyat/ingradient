import type { ProductSnapshot } from '../../domain/contracts/generated/local';

/**
 * Bounded source-tag routing, never "any tag means general". OFF category
 * names were checked through its taxonomy API on 2026-10-18:
 * https://world.openfoodfacts.org/api/v2/taxonomy?tagtype=categories
 * Route meanings: pinned Nutri-Score2022 general-food report pp.129-135 and
 * 2023 beverages report pp.13-15,72-76 (resources/manifest.json sources).
 * Dry teas/coffees and preparation/powder umbrella tags do not prove a drink.
 */
const BEVERAGE_TAGS = new Set([
  'en:beverages',
  'en:waters',
  'en:spring-waters',
  'en:milks',
  'en:whole-milks',
  'en:fruit-juices',
  'en:fruit-nectars',
  'en:sodas',
  'en:soft-drinks',
  'en:plant-based-beverages',
  'en:tea-based-beverages',
  'en:coffee-drinks',
  'en:energy-drinks',
]);
const FATS_NUTS_SEEDS_TAGS = new Set([
  'en:fats',
  'en:vegetable-fats',
  'en:vegetable-oils',
  'en:nuts',
  'en:nuts-and-their-products',
  'en:seeds',
  'en:butters',
  'en:margarines',
]);
const EXCLUDED_TAGS = new Set([
  'en:baby-foods',
  'en:infant-formulas',
  'en:alcoholic-beverages',
  'en:dietary-supplements',
]);
const GENERAL_TAGS = new Set([
  'en:biscuits',
  'en:breads',
  'en:cheeses',
  'en:meats',
  'en:chocolates',
  'en:chocolate-spreads',
  'en:fruits',
  'en:vegetables',
  'en:meals',
  'en:beef',
  'en:beef-and-its-products',
  'en:veal-meat',
  'en:pork',
  'en:pork-and-its-products',
  'en:lamb-meat',
  'en:sheep-meat',
  'en:goat-meat',
  'en:horse-meat',
  'en:venison',
]);

/** No as-consumed nutrition/preparation assertion exists in this input contract.
 * SC2023 pp.13-15/72 requires that basis for powders. These known preparation
 * or ambiguous dry/drink tags override generic beverage ancestors.
 */
const PREPARATION_OR_AMBIGUOUS_TAGS = new Set([
  'en:teas',
  'en:coffees',
  'en:milk-powders',
  'en:instant-coffees',
  'en:ground-coffees',
  'en:coffee-beans',
  'en:tea-bags',
  'en:tea-leaves',
  'en:beverage-preparations',
  'en:dehydrated-beverages',
  'en:instant-beverages',
]);

export function resolveOffCategory(
  tags: readonly string[] = [],
): ProductSnapshot['category'] {
  if (tags.some((tag) => EXCLUDED_TAGS.has(tag))) return 'excluded';
  if (tags.some((tag) => PREPARATION_OR_AMBIGUOUS_TAGS.has(tag)))
    return 'unknown';
  const beverage = tags.some((tag) => BEVERAGE_TAGS.has(tag));
  const fats = tags.some((tag) => FATS_NUTS_SEEDS_TAGS.has(tag));
  if (beverage && fats) return 'unknown';
  if (beverage) return 'beverage';
  if (fats) return 'fats_nuts_seeds';
  return tags.some((tag) => GENERAL_TAGS.has(tag)) ? 'general' : 'unknown';
}
