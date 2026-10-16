import { interpretNumberToken } from './amount';
import { formatDecimal, type Decimal } from './decimal';
import { canonicalUnit, cleanLabel, type AmountUnit } from './units';

/**
 * Names copied from resources/method/nutriscore-updated-2023.json `inputFields`.
 * `added_sugars` and `sodium` are not scoring inputs. They stay separate so a
 * label's added-sugar row is never stored as total sugars, and sodium is never
 * stored as salt.
 */
export const NUTRIENT_FIELDS = {
  energy: 'energy',
  sugars: 'sugars',
  addedSugars: 'added_sugars',
  saturates: 'saturates',
  salt: 'salt',
  sodium: 'sodium',
  protein: 'protein',
  fibre: 'fibre',
  fat: 'fat',
  fvl: 'fvl',
} as const;

export type NutrientField =
  (typeof NUTRIENT_FIELDS)[keyof typeof NUTRIENT_FIELDS];

export type Basis = 'per_100_g' | 'per_100_ml' | 'per_serving';

export type { AmountUnit } from './units';

export interface ServingSize {
  amount: Decimal;
  unit: 'g' | 'ml';
}

/**
 * Annex I point 11 of Regulation (EU) No 1169/2011 defines salt as a calculated
 * equivalent, not as a second measurement of sodium. The comma in "2,5" is the
 * Journal's decimal comma.
 */
export const SALT_FORMULA_NOTE =
  'Regulation (EU) No 1169/2011, Annex I, point 11: ‘salt’ means the salt equivalent content calculated using the formula: salt = sodium × 2,5.';

export const SALT_FORMULA_URL =
  'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R1169';

/**
 * FAO states 1 kcal = 4.184 kJ. Regulation (EU) No 1169/2011 Annex XIV instead
 * lists kilojoules and kilocalories as separate nutrient factors, so a printed
 * kilojoule figure is never replaced by this multiplication.
 */
export const KCAL_TO_KJ_NOTE =
  'FAO Food and Nutrition Paper 77 (2003), chapter 3: 1 kcal = 4.184 kJ. Used only when the label states kilocalories and no kilojoules.';

export const KCAL_TO_KJ_URL = 'https://www.fao.org/4/y5022e/y5022e04.htm';

export type ClassifiedLabel =
  | { kind: 'field'; field: NutrientField; declaredUnit: AmountUnit | null }
  | { kind: 'ignore'; label: string }
  | { kind: 'unknown' };

export type HeaderClassification =
  | { kind: 'basis'; basis: Basis; serving: ServingSize | null }
  | { kind: 'reference' }
  | { kind: 'serving_size'; serving: ServingSize }
  | { kind: 'incomplete_basis' }
  | { kind: 'label_header' };

const FIELD_RULES: readonly { re: RegExp; field: NutrientField | 'ignore' }[] =
  [
    { re: /^(?:energy value|energy|calories|calorie)$/, field: 'energy' },
    {
      re: /^(?:(?:of which|including|incl\.?)\s+)?added sugars?$/,
      field: 'added_sugars',
    },
    {
      re: /^(?:total sugars|of which total sugars|of which sugars|sugars|total sugar|sugar)$/,
      field: 'sugars',
    },
    { re: /^(?:trans fats?|trans fatty acids)$/, field: 'ignore' },
    {
      re: /^(?:of which\s+)?(?:saturates|saturated fat|saturated fatty acids|sat\.?\s+fat)$/,
      field: 'saturates',
    },
    {
      re: /^(?:mono-?unsaturates|monounsaturated(?: fat)?|poly-?unsaturates|polyunsaturated(?: fat)?)$/,
      field: 'ignore',
    },
    { re: /^(?:total fats?|fats?|total lipids|lipids)$/, field: 'fat' },
    { re: /^(?:salt equivalent|salt)$/, field: 'salt' },
    { re: /^sodium$/, field: 'sodium' },
    { re: /^proteins?$/, field: 'protein' },
    {
      re: /^(?:dietary fibre|dietary fiber|of which fibre|of which fiber|fibres?|fibers?)$/,
      field: 'fibre',
    },
    {
      re: /^(?:total carbohydrates?|carbohydrates?|available carbohydrate|of which starch|starch|polyols?|sugar alcohols?|cholesterol)$/,
      field: 'ignore',
    },
    {
      re: /^fruits?(?:\s*,\s*|\s+and\s+|\s+)vegetables?(?:\s*,?\s*and\s+legumes)?$/,
      field: 'fvl',
    },
  ];

export { cleanLabel } from './units';

export function classifyLabel(text: string): ClassifiedLabel {
  const split = splitDeclaredUnit(cleanLabel(text));
  for (const rule of FIELD_RULES) {
    if (rule.re.test(split.name)) {
      if (rule.field === 'ignore') {
        return { kind: 'ignore', label: split.name };
      }
      return { kind: 'field', field: rule.field, declaredUnit: split.unit };
    }
  }
  return { kind: 'unknown' };
}

/**
 * A basis that shares its row with another cell ("Nutrient | Quantity per 100 g").
 * A one-cell "Quantity per 100 g" row is a caption; `parseCaption` already
 * reads that shape, and this function does not replace it.
 */
const HEADER_LEAD =
  '(?:(?:average\\s+quantity|average\\s+amount|quantity|amount|average)\\s+)?';

export function parseHeader(text: string): HeaderClassification | null {
  const cleaned = cleanLabel(text);
  if (cleaned.length === 0) {
    return null;
  }
  if (isReferenceHeader(cleaned)) {
    return { kind: 'reference' };
  }
  if (
    new RegExp(
      `^${HEADER_LEAD}(?:per\\s+|\\/\\s*)?100\\s*(?:grams?|gms?|g)$`,
    ).test(cleaned)
  ) {
    return { kind: 'basis', basis: 'per_100_g', serving: null };
  }
  if (
    new RegExp(
      `^${HEADER_LEAD}(?:per\\s+|\\/\\s*)?100\\s*(?:millilit(?:re|er)s?|ml)$`,
    ).test(cleaned)
  ) {
    return { kind: 'basis', basis: 'per_100_ml', serving: null };
  }
  if (new RegExp(`^${HEADER_LEAD}(?:per\\s+|\\/\\s*)?100$`).test(cleaned)) {
    return { kind: 'incomplete_basis' };
  }
  const servingHeader = new RegExp(
    `^${HEADER_LEAD}(?:per|each)\\s+(?:serve|serving|portion|srv)\\b(.*)$`,
  ).exec(cleaned);
  if (servingHeader) {
    return {
      kind: 'basis',
      basis: 'per_serving',
      serving: parseServingSize(servingHeader[1] ?? ''),
    };
  }
  if (cleaned.includes('(')) {
    const serving = parseServingSize(cleaned);
    if (serving !== null && /^\(?\s*\d/.test(cleaned)) {
      return { kind: 'serving_size', serving };
    }
  }
  if (
    /^(?:nutrient|nutrients|nutrition information|nutritional information|typical values|amount)$/.test(
      cleaned,
    )
  ) {
    return { kind: 'label_header' };
  }
  return null;
}

/**
 * A caption carries a basis for a one-column table ("Typical values per 100 g").
 * A cell that is only "Per 100 g" is a column header, not a caption.
 */
export function parseCaption(text: string): Basis | 'incomplete' | null {
  const cleaned = cleanLabel(text);
  if (
    /^(?:per\s+|\/\s*)?100(?:\s*(?:grams?|gms?|g|millilit(?:re|er)s?|ml))?$/.test(
      cleaned,
    )
  ) {
    return null;
  }
  const hasMass = /(?:^|\b)(?:per|\/)\s*100\s*(?:grams?|gms?|g)\b/.test(
    cleaned,
  );
  const hasVolume =
    /(?:^|\b)(?:per|\/)\s*100\s*(?:millilit(?:re|er)s?|ml)\b/.test(cleaned);
  if (hasMass && hasVolume) {
    return null;
  }
  if (hasMass) {
    return 'per_100_g';
  }
  if (hasVolume) {
    return 'per_100_ml';
  }
  if (/(?:^|\b)(?:per|\/)\s*100\b/.test(cleaned)) {
    return 'incomplete';
  }
  return null;
}

function isReferenceHeader(text: string): boolean {
  return (
    /%\s*(?:rda|gda|dv|nrv|ri|daily value)\b/.test(text) ||
    /^(?:rda|gda|dv|nrv|ri)\s*%$/.test(text) ||
    text === '%' ||
    text === 'percent'
  );
}

function splitDeclaredUnit(text: string): {
  name: string;
  unit: AmountUnit | null;
} {
  const match =
    /^(.*?)(?:\s*[([{]\s*(micrograms?|milligrams?|kilocalories|kilojoules|µg|μg|mcg|ug|mg|grams?|gms?|kcal|kj|g|%|percent)\s*[)\]}])\s*$/i.exec(
      text,
    );
  if (match === null) {
    return { name: text, unit: null };
  }
  const name = (match[1] ?? '').trim();
  const unit = canonicalUnit(match[2] ?? '');
  return { name, unit };
}

function parseServingSize(text: string): ServingSize | null {
  const match =
    /(\d+(?:[.,]\d+)?)\s*(millilit(?:re|er)s?|grams?|gms?|ml|g)\b/i.exec(text);
  if (match === null) {
    return null;
  }
  const interpreted = interpretNumberToken(match[1] ?? '');
  const unit = servingMassUnit(match[2] ?? '');
  if (interpreted === 'ambiguous' || unit === null) {
    return null;
  }
  return { amount: interpreted, unit };
}

function servingMassUnit(raw: string): 'g' | 'ml' | null {
  const unit = raw.toLowerCase();
  if (
    unit === 'ml' ||
    unit === 'millilitre' ||
    unit === 'milliliter' ||
    unit === 'millilitres' ||
    unit === 'milliliters'
  ) {
    return 'ml';
  }
  return canonicalUnit(unit) === 'g' ? 'g' : null;
}

export function servingDerivation(serving: ServingSize): string {
  const unit = serving.unit === 'g' ? 'g' : 'ml';
  return `Header states a serving of ${formatDecimal(serving.amount)} ${unit}. The amount was not converted to per 100 g or per 100 ml.`;
}
