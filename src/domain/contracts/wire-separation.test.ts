/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import type { LocalProfile, PersonalAssessment } from './generated/local';
import type { AnalyzeRequest, ProductInputObservation } from './generated/wire';

type NotAssignable<A, B> = A extends B ? never : true;

export const profileIsNotAWireRequest: NotAssignable<LocalProfile, AnalyzeRequest> = true;
export const personalIsNotAWireRequest: NotAssignable<PersonalAssessment, AnalyzeRequest> = true;
export const requestIsNotAProfile: NotAssignable<AnalyzeRequest, LocalProfile> = true;

export function showProfileIsNotARequest(profile: LocalProfile): AnalyzeRequest {
  // @ts-expect-error A local profile cannot be passed as an analysis request.
  return profile;
}

export function showPersonalIsNotARequest(personal: PersonalAssessment): AnalyzeRequest {
  // @ts-expect-error A personal assessment cannot be passed as an analysis request.
  return personal;
}

export function showEstimatedIsNotAWireObservation(
  observation: ProductInputObservation,
): ProductInputObservation {
  return {
    ...observation,
    // @ts-expect-error estimated is local-only and is not a wire observation kind.
    kind: 'estimated',
  };
}

describe('wire and local types', () => {
  it('keeps profile and personal state off the analysis request', () => {
    expect(profileIsNotAWireRequest).toBe(true);
    expect(personalIsNotAWireRequest).toBe(true);
    expect(requestIsNotAProfile).toBe(true);
    expect(typeof showProfileIsNotARequest).toBe('function');
    expect(typeof showPersonalIsNotARequest).toBe('function');
    expect(typeof showEstimatedIsNotAWireObservation).toBe('function');
  });
});
