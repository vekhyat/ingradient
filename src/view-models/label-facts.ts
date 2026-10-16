import type { ProductSnapshot } from '../domain/contracts/generated/local';
import { parseIngredients } from '../domain/ingredients';
import additiveNames from '../domain/ingredients/generated/additive-names.json';

/**
 * Facts read straight from the ingredient list (D131, ingredients first).
 *
 * Everything here is what the pack itself says: the order of ingredients,
 * declared percentages, additive codes with their printed class, and the
 * "Contains" / "May contain" statements. Additive names come from the pinned
 * Open Food Facts taxonomy (identity only). Nothing here is a health,
 * safety or allergy-compatibility judgement.
 */

interface AdditiveNameTable {
  attribution: string;
  licence: string;
  names: Record<string, { name: string; classes: string[] }>;
}

const TABLE = additiveNames as AdditiveNameTable;

export interface AdditiveFact {
  /** As printed, for example "INS 500(ii)". */
  written: string;
  code: string;
  /** Taxonomy name, or null when the code is not in the pinned table. */
  name: string | null;
  /** The class printed on the pack before the code, such as "raising agents". */
  printedClass: string | null;
}

export interface LabelFacts {
  /** Top-level ingredients in pack order. */
  topLevel: string[];
  percentages: { name: string; text: string }[];
  additives: AdditiveFact[];
  contains: string[];
  mayContain: string[];
  /** Where the additive names come from, shown beside them. */
  additiveNameCredit: string;
}

function tidy(name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  // Labels often shout; show "WHEAT" as "wheat" but keep mixed case as printed.
  return trimmed === trimmed.toUpperCase() ? trimmed.toLowerCase() : trimmed;
}

export function lookupAdditiveName(code: string): string | null {
  return TABLE.names[code.toLowerCase().replace(/\s+/g, '')]?.name ?? null;
}

export function labelFactsFromText(text: string): LabelFacts {
  const parsed = parseIngredients(text);
  const byId = new Map(parsed.mentions.map((m) => [m.id, m]));
  const topLevel: string[] = [];
  const percentages: { name: string; text: string }[] = [];
  const additives: AdditiveFact[] = [];
  const contains: string[] = [];
  const mayContain: string[] = [];

  for (const mention of parsed.mentions) {
    const parent = mention.parentId ? byId.get(mention.parentId) : undefined;
    switch (mention.role) {
      case 'ingredient':
        if (mention.parentId === null) {
          topLevel.push(tidy(mention.name));
        }
        if (mention.percentage) {
          percentages.push({
            name: tidy(mention.name),
            text: mention.percentage.text,
          });
        }
        break;
      case 'additive':
        if (mention.additive) {
          additives.push({
            written: mention.additive.written,
            code: mention.additive.code,
            name: lookupAdditiveName(mention.additive.code),
            printedClass:
              parent?.additiveClass ?? mention.additiveClass ?? null,
          });
        }
        break;
      case 'allergen_contains':
        if (mention.parentId !== null) {
          contains.push(tidy(mention.name));
        }
        break;
      case 'allergen_may_contain':
        if (mention.parentId !== null) {
          mayContain.push(tidy(mention.name));
        }
        break;
    }
  }

  return {
    topLevel,
    percentages,
    additives,
    contains,
    mayContain,
    additiveNameCredit: `Additive names: ${TABLE.attribution}, ${TABLE.licence}`,
  };
}

/** Label facts for a product, from its ingredient panel text; null when there is none. */
export function labelFacts(snapshot: ProductSnapshot): LabelFacts | null {
  const panel = snapshot.panels.find((p) => p.panel === 'ingredients');
  const text = panel?.text?.trim();
  if (!text) {
    return null;
  }
  return labelFactsFromText(text);
}

/** True when the record has nutrition values the grading method could use. */
export function hasNutritionValues(snapshot: ProductSnapshot): boolean {
  return snapshot.observations.some((o) => o.kind !== 'missing');
}
