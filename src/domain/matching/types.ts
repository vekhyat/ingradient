import type { IngredientMention, Issue } from '../contracts/generated/local';
import type { OmittedMention } from '../ingredients';

/**
 * Which pinned dictionary a mention is looked up in. Additive codes are
 * looked up only in `additive`, and only when the parser found an additive
 * code, so a bare number in an ingredient list is never read as an E-number.
 */
export type MatchScope = 'ingredient' | 'additive';

/**
 * How a mention's state was reached.
 * - `exact`: its case/whitespace-normalised name aliases exactly one entry.
 * - `exact_conflict`: the alias belongs to several entries; all are kept.
 * - `additive_code`: the parsed code, suffix included, names one entry.
 * - `fuzzy`: no exact alias; close spellings are suggestions only.
 * - `none`: nothing found.
 * - `incompatible_taxonomy`: the mention's taxonomyVersion is not the pinned one.
 */
export type MatchMethod =
  | 'exact'
  | 'exact_conflict'
  | 'additive_code'
  | 'fuzzy'
  | 'none'
  | 'incompatible_taxonomy';

export interface MentionMatch {
  readonly mentionId: string;
  readonly method: MatchMethod;
  readonly scope: MatchScope | null;
  /** Normalised lookup key that was tried. */
  readonly key: string;
  /** Edit distance of each fuzzy candidate, in candidate order. */
  readonly distances: readonly number[];
}

/**
 * Unknown coverage is reported apart from matches: an unresolved mention is
 * a gap in the taxonomy or the text, not a wrong match.
 */
export interface MatchCoverage {
  readonly mentions: number;
  readonly matched: number;
  readonly ambiguous: number;
  /** Unresolved with fuzzy suggestions. */
  readonly unresolvedWithCandidates: number;
  readonly unresolved: number;
  /** Contains / may contain statements, never matched as ingredients. */
  readonly allergenStatementsOmitted: number;
}

export interface MatchResult {
  /** Contract mentions with state, canonicalId and candidateIds filled. */
  readonly mentions: IngredientMention[];
  readonly omitted: OmittedMention[];
  readonly matches: MentionMatch[];
  readonly coverage: MatchCoverage;
  readonly issues: Issue[];
}
