/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import {
  validateLocalAssessment,
  validateProductSnapshot,
  validateScientificAssessment,
} from '../../domain/contracts/generated/validate-local';
import { validationDetail } from '../../domain/contracts/validator-types';
import {
  buildGradedResult,
  buildInsufficientDataResult,
  buildMethodUnavailableResult,
  buildUnsupportedResult,
  type LocalResultFixture,
} from './local-results';

const results: readonly [string, () => LocalResultFixture][] = [
  ['graded', buildGradedResult],
  ['insufficient data', buildInsufficientDataResult],
  ['method unavailable', buildMethodUnavailableResult],
  ['unsupported', buildUnsupportedResult],
];

describe('local result builders', () => {
  it.each(results)('builds a valid %s result', (_label, build) => {
    const result = build();
    expect(
      validateProductSnapshot(result.snapshot)
        ? ''
        : validationDetail(validateProductSnapshot),
    ).toBe('');
    expect(
      validateScientificAssessment(result.assessment.scientific)
        ? ''
        : validationDetail(validateScientificAssessment),
    ).toBe('');
    expect(
      validateLocalAssessment(result.assessment)
        ? ''
        : validationDetail(validateLocalAssessment),
    ).toBe('');
  });
});
