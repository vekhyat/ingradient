import { describe, expect, it } from '@jest/globals';

import type {
  LookupOutcome,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';
import { getLocalScenario } from '../../fixtures/scenarios';
import {
  methodNotInstalledAnalyser,
  type AnalysisUpdate,
  type ProductAnalyser,
} from './analyser';
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

  it('opens an ingredients-only record as a result (D131)', async () => {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const running = session.lookup('8901030000001');
    pending[0]?.resolve({ state: 'found', snapshot: withoutNutrition });
    const state = await running;
    expect(state.status).toBe('opened');
  });

  it('stays on lookup when the record has neither ingredients nor nutrition', async () => {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const running = session.lookup('8901030000001');
    pending[0]?.resolve({
      state: 'found',
      snapshot: {
        ...withoutNutrition,
        ingredients: [],
        panels: withoutNutrition.panels.map((panel) => ({
          ...panel,
          state: 'missing' as const,
        })),
      },
    });
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

describe('late backend update (D70)', () => {
  const graded = getLocalScenario('complete_graded');

  /** Phone answers at once; the backend's late answer is released by hand. */
  function lateAnalyser() {
    const late: ((update: AnalysisUpdate | null) => void)[] = [];
    const analyser: ProductAnalyser = {
      async analyse(snapshot, signal) {
        const local = await methodNotInstalledAnalyser.analyse(
          snapshot,
          signal,
        );
        return {
          ...local,
          lateUpdate: new Promise<AnalysisUpdate | null>((resolve) =>
            late.push(resolve),
          ),
        };
      },
    };
    return { analyser, late };
  }

  const backendUpdate: AnalysisUpdate = {
    assessment: graded.assessment,
    executor: 'backend',
    introducesHardFinding: false,
  };

  async function openedResult(analyser: ProductAnalyser) {
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, analyser);
    const running = session.lookup('8901030000001');
    pending[0]?.resolve({ state: 'found', snapshot: withNutrition });
    const state = await running;
    if (state.status !== 'opened') {
      throw new Error(`expected opened, got ${state.status}`);
    }
    return { session, key: state.resultKey };
  }

  /** Lets the resolved late promise's handler run. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('offers the update without replacing the displayed result', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    const shown = session.getResult(key)?.assessment;
    late[0]?.(backendUpdate);
    await settle();
    const result = session.getResult(key);
    expect(result?.assessment).toBe(shown);
    expect(result?.executor).toBe('phone');
    expect(result?.pendingUpdate).toMatchObject({
      differsFromDisplayed: true,
      introducesHardFinding: false,
    });
  });

  it('says when the update has the same headline', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    const same = session.getResult(key)?.assessment;
    if (!same) {
      throw new Error('missing result');
    }
    late[0]?.({ ...backendUpdate, assessment: same });
    await settle();
    expect(session.getResult(key)?.pendingUpdate?.differsFromDisplayed).toBe(
      false,
    );
  });

  it('opens the update only on request, as a new result, keeping the phone one', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    const phone = session.getResult(key);
    late[0]?.(backendUpdate);
    await settle();
    const updatedKey = session.openUpdate(key);
    expect(updatedKey).not.toBeNull();
    expect(updatedKey).not.toBe(key);
    const updated = updatedKey ? session.getResult(updatedKey) : undefined;
    expect(updated).toMatchObject({
      executor: 'backend',
      assessment: graded.assessment,
      updateOf: key,
      origin: 'new',
      savedId: null,
    });
    expect(session.getResult(key)?.assessment).toBe(phone?.assessment);
    expect(session.getResult(key)?.pendingUpdate).toBeNull();
    expect(session.openUpdate(key)).toBeNull();
  });

  it('saves what is displayed: the saved phone result keeps its link', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    session.markSaved(key, 'saved-phone');
    late[0]?.(backendUpdate);
    await settle();
    const updatedKey = session.openUpdate(key);
    expect(session.getResult(key)?.savedId).toBe('saved-phone');
    expect(
      updatedKey ? session.getResult(updatedKey)?.savedId : 'x',
    ).toBeNull();
  });

  it('drops the offer when a newer scan supersedes this one', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    void session.lookup('8901030000002');
    late[0]?.(backendUpdate);
    await settle();
    expect(session.getResult(key)?.pendingUpdate).toBeNull();
  });

  it('drops offers and in-flight updates when the app leaves the foreground', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    late[0]?.(backendUpdate);
    await settle();
    expect(session.getResult(key)?.pendingUpdate).not.toBeNull();
    session.dropPendingUpdates();
    expect(session.getResult(key)?.pendingUpdate).toBeNull();

    const second = lateAnalyser();
    const opened = await openedResult(second.analyser);
    opened.session.dropPendingUpdates();
    second.late[0]?.(backendUpdate);
    await settle();
    expect(opened.session.getResult(opened.key)?.pendingUpdate).toBeNull();
  });

  it('ignores a null or failed late update', async () => {
    const { analyser, late } = lateAnalyser();
    const { session, key } = await openedResult(analyser);
    late[0]?.(null);
    await settle();
    expect(session.getResult(key)?.pendingUpdate).toBeNull();

    const rejecting: ProductAnalyser = {
      async analyse(snapshot, signal) {
        const local = await methodNotInstalledAnalyser.analyse(
          snapshot,
          signal,
        );
        return { ...local, lateUpdate: Promise.reject(new Error('502')) };
      },
    };
    const other = await openedResult(rejecting);
    await settle();
    expect(other.session.getResult(other.key)?.pendingUpdate).toBeNull();
  });

  it('drops a label analysis offer once its signal is aborted', async () => {
    const { analyser, late } = lateAnalyser();
    const session = new ScanSession(manualCatalogue().catalogue, analyser);
    const controller = new AbortController();
    const key = await session.analyseSnapshot(withNutrition, controller.signal);
    controller.abort();
    late[0]?.(backendUpdate);
    await settle();
    expect(key && session.getResult(key)?.pendingUpdate).toBeNull();
  });
});

describe('fallback reason (HYB-01)', () => {
  it('keeps why the phone answered on the stored result', async () => {
    const reason = {
      code: 'backend_offline',
      stage: 'method' as const,
      message: 'The analysis server could not be reached.',
      action: 'none' as const,
    };
    const analyser: ProductAnalyser = {
      async analyse(input, signal) {
        return {
          ...(await methodNotInstalledAnalyser.analyse(input, signal)),
          fallbackIssue: reason,
        };
      },
    };
    const { catalogue, pending } = manualCatalogue();
    const session = new ScanSession(catalogue, analyser);
    const running = session.lookup('8901030000001');
    pending[0]?.resolve({ state: 'found', snapshot: withNutrition });
    const state = await running;
    const key = state.status === 'opened' ? state.resultKey : '';
    expect(session.getResult(key)?.fallbackIssue).toEqual(reason);

    const plain = new ScanSession(catalogue, methodNotInstalledAnalyser);
    const labelKey = await plain.analyseSnapshot(
      withNutrition,
      new AbortController().signal,
    );
    expect(labelKey && plain.getResult(labelKey)?.fallbackIssue).toBeNull();
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
