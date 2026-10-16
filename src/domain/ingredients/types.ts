/**
 * Parser output for one ingredient panel.
 *
 * The frozen `IngredientMention` (see `src/domain/contracts/generated/local.ts`)
 * can store a name, a parent and an unresolved match. It cannot store a span,
 * a percentage, an additive suffix or an allergen-statement kind. Those stay
 * here. `toIngredientMentions` copies only the fields the contract has.
 */

export interface TextSpan {
  /** Inclusive start into `IngredientParseResult.text`. UTF-16 code units. */
  start: number;
  /** Exclusive end into `IngredientParseResult.text`. */
  end: number;
}

export type IngredientRole =
  'ingredient' | 'additive' | 'allergen_contains' | 'allergen_may_contain';

export type PercentageQualifier =
  'exact' | 'minimum' | 'maximum' | 'approximate';

export interface ParsedPercentage {
  /** Original characters, for example `63%` or `min. 20%`. */
  text: string;
  span: TextSpan;
  value: number | null;
  qualifier: PercentageQualifier;
}

/**
 * How the code was written. The suffix is never implied by the scheme:
 * `503(ii)` stays `503(ii)` under every scheme.
 */
export type AdditiveScheme =
  'e_number' | 'ins' | 'printed_code' | 'class_context';

export interface AdditiveIdentity {
  /**
   * Digits, optional INS letter and the roman parenthesis exactly as written.
   * `503(ii)` is not `503` and not `503(i)`.
   */
  code: string;
  /** Original characters of the whole token, including an `E` or `INS` label. */
  written: string;
  span: TextSpan;
  scheme: AdditiveScheme;
  /** Exact parenthesis, such as `(ii)` or `(II)`, or null. */
  suffix: string | null;
}

export type IngredientParseIssueCode =
  | 'unbalanced_brackets'
  | 'nesting_limit'
  | 'mention_limit'
  | 'panel_text_limit'
  | 'parse_failure';

export interface IngredientParseIssue {
  code: IngredientParseIssueCode;
  message: string;
  span: TextSpan;
  action: 'retake' | 'edit' | 'none';
}

export interface ParsedMention {
  id: string;
  role: IngredientRole;
  parentId: string | null;
  /** Original printed text. Always `input.slice(span.start, span.end)`. */
  text: string;
  span: TextSpan;
  /**
   * String used for later matching. Nested lists and a percentage note are
   * removed. A hyphenated line-break is joined, so this can differ from any
   * one original slice. Offsets for the pieces are `nameSpans`.
   */
  name: string;
  nameSpans: TextSpan[];
  percentage: ParsedPercentage | null;
  additive: AdditiveIdentity | null;
  /** Lowercase functional class printed on this mention, such as `raising agents`. */
  additiveClass: string | null;
  depth: number;
  issues: IngredientParseIssue[];
}

export interface IngredientParseResult {
  /** The input, unchanged. Every span indexes this string. */
  text: string;
  mentions: ParsedMention[];
  issues: IngredientParseIssue[];
}

export type MentionOmitReason = 'allergen_statement' | 'text_length' | 'empty';

export interface MentionMapContext {
  /** Becomes `IngredientMention.sourceIds`. At least one entry. */
  sourceIds: readonly string[];
  /** Becomes `IngredientMention.taxonomyVersion`. Matching is MAT-01's job. */
  taxonomyVersion: string;
}

export interface OmittedMention {
  id: string;
  reason: MentionOmitReason;
}
