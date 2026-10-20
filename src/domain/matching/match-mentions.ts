import type { IngredientParseResult, MentionMapContext } from '../ingredients';
import { toIngredientMentions } from '../ingredients';
import { MATCH_TAXONOMY_VERSION, matchIngredient } from './match-ingredient';
import type { MatchResult } from './types';

export function matchIngredientMentions(
  parsed: IngredientParseResult,
  context: MentionMapContext,
): MatchResult {
  const mapped = toIngredientMentions(parsed, context);
  const compatible = context.taxonomyVersion === MATCH_TAXONOMY_VERSION;
  const matches: MatchResult['matches'] = [];
  const mentions = mapped.mentions.map((mention) => {
    const original = parsed.mentions.find((item) => item.id === mention.id);
    const opaque = original?.issues.some(
      (issue) => issue.code === 'nesting_limit',
    );
    const identity =
      compatible && !opaque
        ? matchIngredient(mention.text, {
            additiveContext: original?.role === 'additive',
            fuzzy: true,
          })
        : ({
            state: 'unresolved',
            canonicalId: null,
            candidateIds: [],
          } as const);
    const method = !compatible
      ? 'incompatible_taxonomy'
      : identity.state === 'ambiguous'
        ? 'exact_conflict'
        : identity.state === 'matched'
          ? original?.additive
            ? 'additive_code'
            : 'exact'
          : identity.candidateIds.length
            ? 'fuzzy'
            : 'none';
    matches.push({
      mentionId: mention.id,
      method,
      scope: original?.role === 'additive' ? 'additive' : 'ingredient',
      key: mention.text,
      distances:
        identity.state === 'unresolved'
          ? identity.candidateIds.map(() => 1)
          : [],
    });
    return {
      ...mention,
      ...identity,
      candidateIds: [...identity.candidateIds].slice(0, 20),
    };
  });
  return {
    mentions,
    omitted: mapped.omitted,
    matches,
    coverage: {
      mentions: mentions.length,
      matched: mentions.filter((m) => m.state === 'matched').length,
      ambiguous: mentions.filter((m) => m.state === 'ambiguous').length,
      unresolvedWithCandidates: mentions.filter(
        (m) => m.state === 'unresolved' && m.candidateIds.length > 0,
      ).length,
      unresolved: mentions.filter(
        (m) => m.state === 'unresolved' && m.candidateIds.length === 0,
      ).length,
      allergenStatementsOmitted: mapped.omitted.filter(
        (m) => m.reason === 'allergen_statement',
      ).length,
    },
    issues: compatible
      ? []
      : [
          {
            code: 'matching_taxonomy_incompatible',
            stage: 'matching',
            message:
              'The mention taxonomy differs from the installed matching edition.',
            action: 'none',
          },
        ],
  };
}
