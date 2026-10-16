/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import type { AnalyzeResponse } from './generated/wire';
import { validateLocalAssessment, validateProductSnapshot } from './generated/validate-local';
import { ContractValidationError, mapAnalyzeResponse } from './map-analyze-response';

const response: AnalyzeResponse = {
  contractVersion: '0.2.0-draft',
  inputDigest: '0000000000000000000000000000000000000000000000000000000000000000',
  product: {
    id: 'fictional-snapshot',
    barcode: '8901234567890',
    name: null,
    market: 'IN',
    sourceRefs: [{ id: 'src-0', kind: 'label', title: 'Nutrition panel', edition: 'rev-3' }],
    observations: [
      {
        field: 'sugars',
        kind: 'read',
        value: 2.5,
        unit: 'g',
        basis: 'per_100_g',
        sourceIds: ['src-0'],
        issues: [],
      },
    ],
    ingredients: [
      {
        id: 'ing-0',
        text: 'salt',
        parentId: null,
        canonicalId: null,
        state: 'unresolved',
        candidateIds: [],
        sourceIds: ['src-0'],
        taxonomyVersion: 'fictional-taxonomy',
      },
    ],
    category: 'unknown',
    taxonomyVersion: 'fictional-taxonomy',
    evidenceVersion: 'fictional-evidence',
  },
  scientific: {
    state: 'method_unavailable',
    inputSnapshotId: 'fictional-snapshot',
    reasons: [],
    issues: [
      {
        code: 'candidate_method_not_released',
        stage: 'method',
        message: 'A reviewed compatible method bundle is not available.',
        action: 'none',
      },
    ],
  },
  citations: [
    {
      id: 'fixture-citation',
      title: 'Fixture citation',
      issuer: 'Fixture issuer',
      url: 'https://example.com/fixture-citation',
      edition: 'fixture',
      locator: 'fixture',
      claimScope: 'Fixture only.',
      checkedAt: '2026-01-15',
    },
  ],
  issues: [
    {
      code: 'candidate_method_not_released',
      stage: 'method',
      message: 'A reviewed compatible method bundle is not available.',
      action: 'none',
    },
  ],
};

const context = {
  capturedAt: '2026-10-16T00:00:00.000Z',
  panels: [
    {
      panel: 'nutrition' as const,
      state: 'read' as const,
      imageId: null,
      regionId: null,
      issues: [],
    },
  ],
  personal: { state: 'not_in_slice' as const, issues: [] },
};

describe('mapAnalyzeResponse', () => {
  it('copies wire product facts and keeps phone-only fields local', () => {
    const mapped = mapAnalyzeResponse(response, context);
    expect(mapped.snapshot.id).toBe('fictional-snapshot');
    expect(mapped.snapshot.capturedAt).toBe(context.capturedAt);
    expect(mapped.snapshot.panels).toEqual(context.panels);
    expect(mapped.snapshot.sourceRefs).toEqual([
      { id: 'src-0', kind: 'label', title: 'Nutrition panel', edition: 'rev-3' },
    ]);
    expect(mapped.snapshot.observations).toEqual(response.product.observations);
    expect(mapped.snapshot.ingredients).toEqual(response.product.ingredients);
    expect(mapped.assessment.snapshotId).toBe(response.product.id);
    expect(mapped.assessment.scientific).toEqual(response.scientific);
    expect(mapped.assessment.personal).toEqual(context.personal);
    expect(mapped.assessment.citations[0]?.id).toBe('fixture-citation');
    expect(validateProductSnapshot(mapped.snapshot)).toBe(true);
    expect(validateLocalAssessment(mapped.assessment)).toBe(true);
    expect(Object.hasOwn(response, 'personal')).toBe(false);
  });

  it('rejects a response whose snapshot id does not match the science', () => {
    const mismatched: AnalyzeResponse = {
      ...response,
      scientific: { ...response.scientific, inputSnapshotId: 'other-snapshot' },
    };
    expect(() => mapAnalyzeResponse(mismatched, context)).toThrow(ContractValidationError);
  });

  it('rejects a response that carries a personal outcome', () => {
    const withPersonal = { ...response, personal: context.personal };
    expect(() => mapAnalyzeResponse(withPersonal, context)).toThrow(ContractValidationError);
  });
});
