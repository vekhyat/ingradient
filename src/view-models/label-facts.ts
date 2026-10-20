import type { ProductSnapshot } from '../domain/contracts/generated/local';
import { parseIngredients, type ParsedMention } from '../domain/ingredients';
import additiveNames from '../domain/ingredients/generated/additive-names.json';
import { normaliseAdditiveCode } from '../domain/matching';

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
  const normalised = normaliseAdditiveCode(code);
  return normalised ? (TABLE.names[normalised]?.name ?? null) : null;
}

function isAllergenHeader(mention: ParsedMention): boolean {
  // Statement headers have the same role as their items, including nested
  // headers and headers whose children were stopped by a parser limit.
  // Wrapper statements may instead produce root-level items directly.
  return /^(?:(?:this\s+)?product\s+)?(?:contains|may\s+contain(?:\s+traces(?:\s+of)?)?)$/i.test(
    mention.name.trim(),
  );
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
        if (!isAllergenHeader(mention)) {
          contains.push(tidy(mention.name));
        }
        break;
      case 'allergen_may_contain':
        if (!isAllergenHeader(mention)) {
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

/**
 * Overlay reviewed names on the original OCR spans. Keeping panel.text intact
 * preserves the evidence, percentages, nested lists and full allergen
 * statements, which are deliberately absent from the frozen mention shape.
 */
function reviewedIngredientText(
  snapshot: ProductSnapshot,
  text: string,
): string {
  const parsed = parseIngredients(text);
  const byId = new Map(parsed.mentions.map((mention) => [mention.id, mention]));
  const sources = new Map(
    snapshot.sourceRefs.map((source) => [source.id, source]),
  );
  const unreadable = new Set(
    snapshot.panels.flatMap((panel) =>
      panel.issues
        .filter((issue) => issue.code === 'ingredient_unreadable')
        .map((issue) => issue.field),
    ),
  );
  const edits: { start: number; end: number; text: string }[] = [];
  for (const mention of snapshot.ingredients) {
    const corrections = mention.sourceIds
      .map((id) => sources.get(id))
      .filter((source) => source?.kind === 'user_correction');
    if (corrections.length === 0) continue;
    const prefix = `ingredients.${mention.id};parsed=`;
    const locator = corrections.find((source) =>
      source?.locator?.startsWith(prefix),
    )?.locator;
    // Old photo corrections used parser ids without locators. Catalogue ids
    // are a different namespace and must never guess an ambiguous text span.
    const fromPhoto = mention.sourceIds.some(
      (id) => sources.get(id)?.kind === 'label',
    );
    const original = byId.get(
      locator ? locator.slice(prefix.length) : fromPhoto ? mention.id : '',
    );
    if (
      !original ||
      (original.role !== 'ingredient' && original.role !== 'additive') ||
      original.issues.some((issue) => issue.code === 'nesting_limit')
    ) {
      continue;
    }
    if (unreadable.has(`ingredients.${mention.id}`)) {
      edits.push({ ...original.span, text: '' });
    } else if (mention.text !== original.name) {
      original.nameSpans.forEach((span, index) => {
        edits.push({ ...span, text: index === 0 ? mention.text : '' });
      });
    }
  }
  // Whole unreadable parents take precedence over edits to their children.
  edits.sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;
  let reviewed = '';
  for (const edit of edits) {
    if (edit.start < cursor) continue;
    reviewed += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return reviewed + text.slice(cursor);
}

/** Label facts for a product's reviewed transcription; null when there is none. */
export function labelFacts(snapshot: ProductSnapshot): LabelFacts | null {
  const panel = snapshot.panels.find((p) => p.panel === 'ingredients');
  const text = panel?.text;
  if (!text?.trim()) {
    return null;
  }
  return labelFactsFromText(reviewedIngredientText(snapshot, text));
}

/** True when the record has nutrition values the grading method could use. */
export function hasNutritionValues(snapshot: ProductSnapshot): boolean {
  return snapshot.observations.some((o) => o.kind !== 'missing');
}
