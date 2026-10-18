import { describe, expect, it } from '@jest/globals';

import { enGB } from '../../copy/en-GB';
import type { Issue } from '../../domain/contracts/generated/local';
import { backendIssueMessage, withLocalIssueCopy } from './backend-issues';

const SERVER_TEXT = 'UNTRUSTED SERVER SENTENCE';

function issue(code: string, stage: Issue['stage'], field?: string): Issue {
  return {
    code,
    stage,
    ...(field !== undefined ? { field } : {}),
    message: SERVER_TEXT,
    action: 'none',
  };
}

/** The 50 codes the backend catalogue (BE-12, 2026-10-18) emits. */
const NUTRIENTS: Record<string, readonly string[]> = {
  energy: ['missing', 'conflicting', 'unsupported'],
  sugars: ['missing', 'conflicting', 'unsupported', 'invalid'],
  saturates: ['missing', 'conflicting', 'unsupported', 'invalid'],
  salt: ['missing', 'conflicting', 'unsupported', 'invalid'],
  protein: ['missing', 'conflicting', 'unsupported', 'invalid'],
  fibre: ['missing', 'conflicting', 'unsupported', 'invalid'],
  fat: ['missing', 'conflicting', 'unsupported', 'invalid'],
  fvl: ['missing', 'conflicting', 'unsupported', 'invalid'],
};
const nutrientIssues = Object.entries(NUTRIENTS).flatMap(([field, kinds]) =>
  kinds.map((kind) =>
    issue(
      kind === 'unsupported'
        ? `unsupported_${field}_basis`
        : `${kind}_${field}`,
      'completeness',
      field,
    ),
  ),
);
const fixedIssues: Issue[] = [
  issue('unsupported_category', 'method', 'category'),
  issue('conflicting_scoring_facts', 'completeness', 'scoringFacts'),
  issue('missing_cheese', 'completeness', 'cheese'),
  issue('missing_redmeat', 'completeness', 'redMeat'),
  issue('missing_plainwater', 'completeness', 'plainWater'),
  issue('sweetener_presence_unknown', 'completeness', 'nonNutritiveSweetener'),
  issue('conflicting_water_facts', 'completeness', 'plainWater'),
  issue('inconsistent_fat', 'completeness', 'saturates'),
  issue('method_score_out_of_bounds', 'method', 'method'),
  issue('unsupported_method_resource', 'method', 'method'),
  issue('incompatible_resources', 'method', 'resources'),
  issue(
    'missing_category_provenance',
    'completeness',
    'scoringFacts.categorySourceIds',
  ),
  issue('unusable_observation', 'completeness', 'salt'),
  issue('candidate_method_not_released', 'method'),
  issue('allergen_statement_separate', 'matching'),
  issue('ingredients_unavailable', 'matching', 'ingredientsText'),
  issue('ingredient_structure_unresolved', 'matching'),
  issue('ingredients_incomplete', 'matching'),
  issue('ingredient_identity_unresolved', 'matching'),
];

describe('backendIssueMessage', () => {
  it('gives reviewed phone copy for every catalogued code', () => {
    const all = [...nutrientIssues, ...fixedIssues];
    expect(nutrientIssues).toHaveLength(31);
    expect(fixedIssues).toHaveLength(19);
    for (const item of all) {
      const message = backendIssueMessage(item);
      expect(message).not.toBe(SERVER_TEXT);
      expect(message).not.toBe(enGB.backendIssue.unknown);
    }
  });

  it('names the nutrient in its own words', () => {
    expect(
      backendIssueMessage(
        issue('missing_saturates', 'completeness', 'saturates'),
      ),
    ).toBe('No usable saturated fat value was found.');
    expect(
      backendIssueMessage(
        issue('unsupported_fvl_basis', 'completeness', 'fvl'),
      ),
    ).toContain('fruit, vegetables and legumes');
  });

  it('falls back to neutral copy for unknown or mismatched codes', () => {
    const neutral = enGB.backendIssue.unknown;
    for (const item of [
      issue('client_fixture_issue', 'capture', 'untrusted_field'),
      // Known code, wrong stage or field: caller-supplied, not catalogued.
      issue('missing_cheese', 'capture', 'cheese'),
      issue('missing_salt', 'completeness', 'sugars'),
      issue('unusable_observation', 'completeness', 'untrusted_field'),
      issue('candidate_method_not_released', 'method', 'method'),
      // The backend never emits invalid_energy.
      issue('invalid_energy', 'completeness', 'energy'),
      issue('missing_unknownnutrient', 'completeness', 'unknownnutrient'),
      issue('unsupported_salt', 'completeness', 'salt'),
    ]) {
      expect(backendIssueMessage(item)).toBe(neutral);
    }
  });
});

describe('withLocalIssueCopy', () => {
  it('replaces every message and keeps code, stage, field and action', () => {
    const assessment = {
      state: 'insufficient_data' as const,
      issues: [
        issue('missing_salt', 'completeness', 'salt'),
        issue('client_fixture_issue', 'capture', 'x'),
      ],
    };
    const local = withLocalIssueCopy(assessment);
    expect(JSON.stringify(local)).not.toContain(SERVER_TEXT);
    expect(
      local.issues.map(({ code, stage, field, action }) => [
        code,
        stage,
        field,
        action,
      ]),
    ).toEqual(
      assessment.issues.map(({ code, stage, field, action }) => [
        code,
        stage,
        field,
        action,
      ]),
    );
  });
});
