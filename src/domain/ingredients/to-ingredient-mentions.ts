import type { IngredientMention, Issue } from '../contracts/generated/local';
import type {
  IngredientParseResult,
  MentionMapContext,
  OmittedMention,
  ParsedMention,
} from './types';

/**
 * `IngredientMention.text` is frozen at 2,000 characters.
 * The schema lives in `contracts/local-contract.schema.json`.
 */
const MENTION_TEXT_MAX = 2000;

export interface IngredientMentionMapping {
  mentions: IngredientMention[];
  /** Parser ids that must not be copied into `ProductSnapshot.ingredients`. */
  omitted: OmittedMention[];
}

function sourceTuple(sourceIds: readonly string[]): [string, ...string[]] {
  const first = sourceIds[0];
  if (first === undefined || first.length === 0) {
    throw new TypeError(
      'IngredientMention.sourceIds needs at least one source id.',
    );
  }
  const rest = sourceIds.slice(1);
  if (rest.some((id) => id.length === 0)) {
    throw new TypeError(
      'IngredientMention.sourceIds cannot contain an empty id.',
    );
  }
  return [first, ...rest];
}

function nearestIncluded(
  mention: ParsedMention,
  included: ReadonlySet<string>,
  byId: ReadonlyMap<string, ParsedMention>,
): string | null {
  let parentId = mention.parentId;
  while (parentId !== null) {
    if (included.has(parentId)) {
      return parentId;
    }
    const parent = byId.get(parentId);
    parentId = parent ? parent.parentId : null;
  }
  return null;
}

/**
 * Copies unresolved mentions into the frozen contract.
 * Allergen statements are left out: the contract has no statement kind,
 * and a contains row must not become the same shape as a may-contain row.
 * Additive suffixes survive only when they are part of `name`.
 * Spans, percentages and the suffix field stay on `IngredientParseResult`.
 */
export function toIngredientMentions(
  result: IngredientParseResult,
  context: MentionMapContext,
): IngredientMentionMapping {
  const taxonomyVersion = context.taxonomyVersion.trim();
  if (taxonomyVersion.length === 0) {
    throw new TypeError('IngredientMention.taxonomyVersion cannot be empty.');
  }
  const sourceIds = sourceTuple(context.sourceIds);
  const byId = new Map(result.mentions.map((mention) => [mention.id, mention]));
  const omitted: OmittedMention[] = [];
  const included = new Set<string>();
  for (const mention of result.mentions) {
    if (
      mention.role === 'allergen_contains' ||
      mention.role === 'allergen_may_contain'
    ) {
      omitted.push({ id: mention.id, reason: 'allergen_statement' });
      continue;
    }
    const text = mention.name.trim();
    if (text.length === 0) {
      omitted.push({ id: mention.id, reason: 'empty' });
      continue;
    }
    if (text.length > MENTION_TEXT_MAX) {
      omitted.push({ id: mention.id, reason: 'text_length' });
      continue;
    }
    included.add(mention.id);
  }
  const mentions: IngredientMention[] = [];
  for (const mention of result.mentions) {
    if (!included.has(mention.id)) {
      continue;
    }
    mentions.push({
      id: mention.id,
      text: mention.name.trim(),
      parentId: nearestIncluded(mention, included, byId),
      canonicalId: null,
      state: 'unresolved',
      candidateIds: [],
      sourceIds: [sourceIds[0], ...sourceIds.slice(1)],
      taxonomyVersion,
    });
  }
  return { mentions, omitted };
}

/** Panel issues for the frozen `Issue` shape. Spans stay on the parser issue. */
export function toExtractionIssues(result: IngredientParseResult): Issue[] {
  return result.issues.map((issue) => ({
    code: issue.code,
    stage: 'extraction',
    field: 'ingredients',
    message: issue.message,
    action: issue.action,
  }));
}
