import { describe, expect, it } from '@jest/globals';

import type {
  LookupOutcome,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';
import { getLocalScenario } from '../../fixtures/scenarios';
import { methodNotInstalledAnalyser } from './analyser';
import { checkTypedBarcode } from './barcode-input';
import { ScanSession, type CatalogueLookup } from './scan-session';

/** Catalogue whose answers the test releases by hand. */
function manualCatalogue() {
  const pending: { barcode: string; resolve: (o: LookupOutcome) => void }[] =
    [];
  const catalogue: CatalogueLookup = {
    lookupBarcode: (barcode) =>
      new Promise((resolve) => pending.push({ barcode, resolve })),
  };
  return { catalogue, pending };
}

const withNutrition = getLocalScenario('complete_graded').snapshot;
const withoutNutrition: ProductSnapshot = {
  ...withNutrition,
  id: 'off:empty',
  observations: [],
};

describe('ScanSession lookup', () => {
  it('opens a result for a found product with nutrition', async () => {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const running = session.lookup('8901030000001');
    expect(session.getState().lookup).toMatchObject({
      status: 'pending',
      stage: 'lookup',
    });
    pending[0]?.resolve({ state: 'found', snapshot: withNutrition });
    const state = await running;
    expect(state.status).toBe('opened');
    if (state.status === 'opened') {
      const result = session.getResult(state.resultKey);
      expect(result?.assessment.scientific.state).toBe('method_unavailable');
      expect(result?.origin).toBe('new');
    }
  });

  it('stays on lookup when the record cannot be graded without a photo', async () => {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const running = session.lookup('8901030000001');
    pending[0]?.resolve({ state: 'found', snapshot: withoutNutrition });
    const state = await running;
    expect(state.status).toBe('incomplete');
    expect(Object.keys(session.getState().results)).toHaveLength(0);
  });

  it('keeps absent, offline and throttled as different failures', async () => {
    const cases: [LookupOutcome, string][] = [
      [{ state: 'absent', issues: [] }, 'absent'],
      [{ state: 'offline', issues: [] }, 'offline'],
      [{ state: 'throttled', issues: [], retryAfterSeconds: 20 }, 'throttled'],
    ];
    for (const [outcome, status] of cases) {
      const { catalogue, pending } = manualCatalogue();
      const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
      const running = session.lookup('8901030000001');
      pending[0]?.resolve(outcome);
      const state = await running;
      expect(state).toMatchObject({ status: 'failed', failure: { status } });
    }
  });

  it('ignores a late answer after Cancel', async () => {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const running = session.lookup('8901030000001');
    session.cancelLookup();
    pending[0]?.resolve({ state: 'found', snapshot: withNutrition });
    await running;
    expect(session.getState().lookup).toEqual({ status: 'idle' });
    expect(Object.keys(session.getState().results)).toHaveLength(0);
  });

  it('lets a newer lookup win over an older late one', async () => {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const first = session.lookup('8901030000001');
    const second = session.lookup('8901030000002');
    pending[1]?.resolve({ state: 'absent', issues: [] });
    await second;
    pending[0]?.resolve({ state: 'found', snapshot: withNutrition });
    await first;
    expect(session.getState().lookup).toMatchObject({
      status: 'failed',
      barcode: '8901030000002',
    });
    expect(Object.keys(session.getState().results)).toHaveLength(0);
  });

  it('treats a thrown lookup as a service failure, not a crash', async () => {
    const catalogue: CatalogueLookup = {
      lookupBarcode: () => Promise.reject(new Error('socket closed')),
    };
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const state = await session.lookup('8901030000001');
    expect(state).toMatchObject({
      status: 'failed',
      failure: { status: 'upstream_unavailable' },
    });
  });
});

describe('results', () => {
  it('tracks the saved copy and forgets it after delete', () => {
    const session = new ScanSession(
      { lookupBarcode: () => Promise.resolve({ state: 'absent', issues: [] }) },
      methodNotInstalledAnalyser,
    );
    const scenario = getLocalScenario('complete_graded');
    const key = session.addResult(
      scenario.snapshot,
      scenario.assessment,
      'phone',
    );
    session.markSaved(key, 'saved-1');
    expect(session.getResult(key)?.savedId).toBe('saved-1');
    session.forgetSaved('saved-1');
    expect(session.getResult(key)?.savedId).toBeNull();
  });
});

describe('checkTypedBarcode', () => {
  it('rejects bad input before any lookup', () => {
    expect(checkTypedBarcode('')).toEqual({ ok: false, error: 'empty' });
    expect(checkTypedBarcode('8901 2345')).toEqual({
      ok: false,
      error: 'invalid_chars',
    });
    expect(checkTypedBarcode('12345')).toEqual({
      ok: false,
      error: 'invalid_length',
    });
    expect(checkTypedBarcode('123456789012345')).toEqual({
      ok: false,
      error: 'too_long',
    });
    expect(checkTypedBarcode('8901030000000')).toEqual({
      ok: false,
      error: 'invalid_checksum',
    });
  });

  it('accepts a valid EAN-13', () => {
    expect(checkTypedBarcode('3017624010701')).toEqual({
      ok: true,
      code: '3017624010701',
    });
  });
});
