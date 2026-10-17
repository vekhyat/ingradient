import type {
  PresenceFact,
  ScoringFacts,
} from '../../domain/contracts/generated/local';
import type { OffIngredientV3, OffProductV3 } from './types';
import { resolveOffCategory } from './off-category';

/**
 * Derives ADR013 scoring facts from an Open Food Facts product (DAT-01, D146).
 *
 * A fact is `present` or `absent` only when an OFF category tag or OFF's own
 * ingredient analysis supports it; otherwise it is `unknown`. A missing tag
 * never proves absence. Every non-unknown fact cites the OFF source.
 *
 * Sources for the rules below:
 * - [SC22] Scientific Committee of the Nutri-Score, 2022 update report for
 *   general foods, printed p. 87 section 3.2 (red meat products), p. 49
 *   (cheese protein exception kept).
 *   https://mpc.gouvernement.lu/dam-assets/le-minist%C3%A8re/consodur/2022-main-algorithm-report-update-final.pdf
 * - [SC23] Scientific Committee of the Nutri-Score, 2023 beverages report,
 *   p. 13 (Codex 14.1.1 waters), p. 22 (flavoured waters are a separate type),
 *   p. 27 Table 2 (sweeteners included for Nutri-Score).
 *   https://edepot.wur.nl/629571
 * - [OFF] Open Food Facts server, lib/ProductOpener/Food.pm:
 *   is_cheese_for_nutrition_score and is_water_for_nutrition_score (tag rules).
 *   https://github.com/openfoodfacts/openfoodfacts-server/blob/main/lib/ProductOpener/Food.pm
 * - [OFF-TAX] Open Food Facts categories and ingredients taxonomies, checked
 *   2026-10-17 through https://world.openfoodfacts.org/api/v2/taxonomy
 */

/** [OFF] cheese rule: en:cheeses, except fromages blancs. */
const CHEESE_TAG = 'en:cheeses';
const NOT_CHEESE_TAGS = new Set(['fr:fromages-blancs']);

/**
 * [SC22] p. 87: red meat products are typically from beef, veal, swine and
 * lamb, including game/venison, horse and goat, and processed products from
 * swine, lamb or beef. Tags verified in [OFF-TAX].
 */
const RED_MEAT_TAGS = new Set([
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

/**
 * [OFF] water rule: spring waters (which include mineral waters in
 * [OFF-TAX]), excluding flavoured waters. [SC23] p. 22 treats flavoured
 * waters as their own beverage type; vitamin waters are excluded likewise.
 */
const PLAIN_WATER_TAG = 'en:spring-waters';
const NOT_PLAIN_WATER_TAGS = new Set([
  'en:flavored-waters',
  'en:flavoured-waters',
  'en:vitamin-waters',
]);

/**
 * Beverage types that are not plain water ([SC23] pp. 13-15 list them as
 * separate beverage groups). A positive tag here supports `absent`.
 */
const OTHER_BEVERAGE_TAGS = new Set([
  'en:sodas',
  'en:fruit-juices',
  'en:fruit-nectars',
  'en:vegetable-juices',
  'en:smoothies',
  'en:milks',
  'en:dairy-drinks',
  'en:plant-based-beverages',
  'en:energy-drinks',
  'en:tea-based-beverages',
  'en:iced-teas',
  'en:coffee-drinks',
  'en:sweetened-beverages',
  'en:artificially-sweetened-beverages',
  'en:syrups',
  'en:flavored-waters',
  'en:flavoured-waters',
  'en:vitamin-waters',
]);

/**
 * [SC23] p. 27 Table 2, sweeteners marked "Included for the purpose of
 * Nutri-Score classification", matching the pinned bundle
 * (resources/method sweetenersCatalogue.included). OFF ingredient ids are
 * E-number ids; sub-ids such as en:e954i have the main id as parent.
 */
const INCLUDED_SWEETENER_IDS = new Set([
  'en:e950',
  'en:e951',
  'en:e952',
  'en:e952i',
  'en:e952ii',
  'en:e952iv',
  'en:e954',
  'en:e954i',
  'en:e954ii',
  'en:e954iii',
  'en:e954iv',
  'en:e955',
  'en:e957',
  'en:e959',
  'en:e960a',
  'en:e961',
  'en:e962',
  'en:e969',
  // Explicit ingredient identities in the pinned ingredients taxonomy lines930/935;
  // E952's pinned additive English names identify cyclamates/sodium cyclamate.
  'en:cyclamate',
  'en:sodium-cyclamate',
]);

const UNKNOWN: PresenceFact = { state: 'unknown' };

/** Presence can be established by one supported ingredient; absence cannot.
 * is_in_taxonomy describes a term, never completeness of the product panel.
 */
function hasIncludedSweetener(
  ingredients: readonly OffIngredientV3[] | undefined,
): boolean {
  if (!Array.isArray(ingredients)) return false;
  return ingredients.some((item) => {
    if (typeof item !== 'object' || item === null) return false;
    return (
      (typeof item.id === 'string' && INCLUDED_SWEETENER_IDS.has(item.id)) ||
      hasIncludedSweetener(item.ingredients)
    );
  });
}

function known(state: 'present' | 'absent', sourceId: string): PresenceFact {
  return { state, sourceIds: [sourceId] };
}

/**
 * Returns the facts, or undefined when nothing is supported (omission means
 * every fact is unknown, ADR013).
 *
 * `category` is the route the mapper resolved from the same tags; facts that
 * the contract ties to another route stay unknown.
 */
export function deriveScoringFacts(
  product: OffProductV3,
  category: 'general' | 'fats_nuts_seeds' | 'beverage' | 'excluded' | 'unknown',
  sourceId: string,
): ScoringFacts | undefined {
  const tags = new Set(product.categories_tags ?? []);
  const has = (set: ReadonlySet<string>) =>
    [...set].some((tag) => tags.has(tag));
  const cheeseTagged = tags.has(CHEESE_TAG) && !has(NOT_CHEESE_TAGS);
  const redMeatTagged = has(RED_MEAT_TAGS);
  const conflicting = cheeseTagged && redMeatTagged;

  let cheese = UNKNOWN;
  if (cheeseTagged && !conflicting && category === 'general') {
    cheese = known('present', sourceId);
  }

  let redMeat = UNKNOWN;
  if (redMeatTagged && !conflicting && category === 'general') {
    redMeat = known('present', sourceId);
  }

  let nonNutritiveSweetener = UNKNOWN;
  if (hasIncludedSweetener(product.ingredients)) {
    nonNutritiveSweetener = known('present', sourceId);
  }

  let plainWater = UNKNOWN;
  const waterTagged = tags.has(PLAIN_WATER_TAG) && !has(NOT_PLAIN_WATER_TAGS);
  if (nonNutritiveSweetener.state === 'present') {
    // Water with a sweetener is not plain water.
    plainWater = known('absent', sourceId);
  } else if (
    waterTagged &&
    !has(OTHER_BEVERAGE_TAGS) &&
    category === 'beverage'
  ) {
    plainWater = known('present', sourceId);
  } else if (!waterTagged && has(OTHER_BEVERAGE_TAGS)) {
    plainWater = known('absent', sourceId);
  }

  const categorySourceIds =
    category !== 'unknown' &&
    resolveOffCategory(product.categories_tags) === category
      ? [sourceId]
      : [];
  const facts: ScoringFacts = {
    categorySourceIds,
    cheese,
    redMeat,
    plainWater,
    nonNutritiveSweetener,
  };
  const anything =
    categorySourceIds.length > 0 ||
    [cheese, redMeat, plainWater, nonNutritiveSweetener].some(
      (fact) => fact.state !== 'unknown',
    );
  return anything ? facts : undefined;
}
