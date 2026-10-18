import { enGB } from '../../copy/en-GB';
import type { Issue } from '../../domain/contracts/generated/local';

/**
 * Replaces the analysis server's issue messages with reviewed phone copy, so
 * no server sentence reaches the screen (D105's rule, applied to gaps too).
 *
 * The code alone does not prove where an issue came from: the wire accepts
 * any well-formed code, and the backend forwards caller-supplied issues. So a
 * code gets its copy only when its stage and field are exactly the ones the
 * backend catalogue (BE-12, 2026-10-18) names. Anything else gets one neutral
 * local message. Code, stage, field and action are kept for the UI.
 */

type NutrientField = keyof typeof enGB.backendIssue.nutrientLabel;

const NUTRIENT_FIELDS = new Set<string>(
  Object.keys(enGB.backendIssue.nutrientLabel),
);

const NUTRIENT_CODE =
  /^(missing|conflicting|invalid)_([a-z]+)$|^unsupported_([a-z]+)_basis$/;

type FixedCode = keyof typeof enGB.backendIssue.fixed;

/** The exact stage and field each fixed code is emitted with. */
const FIXED: Readonly<
  Record<FixedCode, { stage: Issue['stage']; field: string | undefined }>
> = {
  unsupported_category: { stage: 'method', field: 'category' },
  conflicting_scoring_facts: { stage: 'completeness', field: 'scoringFacts' },
  missing_cheese: { stage: 'completeness', field: 'cheese' },
  missing_redmeat: { stage: 'completeness', field: 'redMeat' },
  missing_plainwater: { stage: 'completeness', field: 'plainWater' },
  sweetener_presence_unknown: {
    stage: 'completeness',
    field: 'nonNutritiveSweetener',
  },
  conflicting_water_facts: { stage: 'completeness', field: 'plainWater' },
  inconsistent_fat: { stage: 'completeness', field: 'saturates' },
  method_score_out_of_bounds: { stage: 'method', field: 'method' },
  unsupported_method_resource: { stage: 'method', field: 'method' },
  incompatible_resources: { stage: 'method', field: 'resources' },
  missing_category_provenance: {
    stage: 'completeness',
    field: 'scoringFacts.categorySourceIds',
  },
  candidate_method_not_released: { stage: 'method', field: undefined },
  allergen_statement_separate: { stage: 'matching', field: undefined },
  ingredients_unavailable: { stage: 'matching', field: 'ingredientsText' },
  ingredient_structure_unresolved: { stage: 'matching', field: undefined },
  ingredients_incomplete: { stage: 'matching', field: undefined },
  ingredient_identity_unresolved: { stage: 'matching', field: undefined },
};

function isFixedCode(code: string): code is FixedCode {
  return Object.prototype.hasOwnProperty.call(FIXED, code);
}

function nutrientLabel(field: string | undefined): string | null {
  return field !== undefined && NUTRIENT_FIELDS.has(field)
    ? enGB.backendIssue.nutrientLabel[field as NutrientField]
    : null;
}

/** Reviewed phone copy for one server issue, or the neutral message. */
export function backendIssueMessage(issue: Issue): string {
  const copy = enGB.backendIssue;
  if (isFixedCode(issue.code)) {
    const expected = FIXED[issue.code];
    return expected.stage === issue.stage && expected.field === issue.field
      ? copy.fixed[issue.code]
      : copy.unknown;
  }
  if (issue.code === 'unusable_observation') {
    const label = nutrientLabel(issue.field);
    return issue.stage === 'completeness' && label !== null
      ? copy.unusable(label)
      : copy.unknown;
  }
  const match = NUTRIENT_CODE.exec(issue.code);
  if (!match || issue.stage !== 'completeness') {
    return copy.unknown;
  }
  const kind = match[1] ?? 'unsupported';
  const field = match[2] ?? match[3];
  // The field must name the same nutrient as the code; the backend never
  // emits invalid_energy, so that code is not trusted either.
  const label = field === issue.field ? nutrientLabel(field) : null;
  if (label === null || (kind === 'invalid' && field === 'energy')) {
    return copy.unknown;
  }
  switch (kind) {
    case 'missing':
      return copy.missing(label);
    case 'conflicting':
      return copy.conflicting(label);
    case 'invalid':
      return copy.invalid(label);
    default:
      return copy.unsupportedBasis(label);
  }
}

/**
 * The same assessment with each issue message replaced. Only messages change
 * (length, order and every other field stay), so the variant's own issue
 * shape, such as a required non-empty list, still holds.
 */
export function withLocalIssueCopy<A extends { issues: readonly Issue[] }>(
  assessment: A,
): A {
  return {
    ...assessment,
    issues: assessment.issues.map((issue) => ({
      ...issue,
      message: backendIssueMessage(issue),
    })),
  } as A;
}
