import { describe, expect, it } from '@jest/globals';

import { buildMockAnalyzeResponse } from '../../mocks/backend';
import { getLocalScenario } from '../../fixtures/scenarios';
import { checkBackendAnswer } from './offer';
import { buildAnalyzeRequest } from './request';
import { installedResources } from './resources';

const resources = installedResources();
const built = buildAnalyzeRequest(
  getLocalScenario('complete_graded').snapshot,
  resources,
);
if (!built.ok) {
  throw new Error(built.issue.message);
}
const sentBody = built.body;
const check = (overrides: Partial<Parameters<typeof checkBackendAnswer>[0]>) =>
  checkBackendAnswer({
    sentBody,
    response: buildMockAnalyzeResponse(sentBody),
    resources,
    scanActive: true,
    now: 1000,
    deadline: 2000,
    ...overrides,
  });

describe('checkBackendAnswer (D70, HYB-01 case 4)', () => {
  it('accepts the answer for the exact body with installed editions', () => {
    expect(check({})).toEqual({ ok: true });
  });

  it('rejects once the scan is inactive or the deadline passed', () => {
    expect(check({ scanActive: false })).toEqual({
      ok: false,
      reason: 'scan_inactive',
    });
    expect(check({ now: 2001 })).toEqual({
      ok: false,
      reason: 'deadline_passed',
    });
  });

  it('rejects a digest of any other body, even one byte different', () => {
    const other = sentBody.replace('"market":"IN"', '"market":"EU"');
    expect(check({ response: buildMockAnalyzeResponse(other) })).toEqual({
      ok: false,
      reason: 'digest_mismatch',
    });
  });

  it('rejects other editions and other method bundles', () => {
    expect(
      check({
        response: buildMockAnalyzeResponse(sentBody, { editionMismatch: true }),
      }),
    ).toEqual({ ok: false, reason: 'method_mismatch' });
    expect(
      check({
        response: buildMockAnalyzeResponse(sentBody, {
          bundleHashMismatch: true,
        }),
      }),
    ).toEqual({ ok: false, reason: 'method_mismatch' });
    expect(
      check({ resources: { ...resources, taxonomyVersion: 'older-taxonomy' } }),
    ).toEqual({ ok: false, reason: 'edition_mismatch' });
  });
});
