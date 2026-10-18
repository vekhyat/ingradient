import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import vectors from '../../../resources/vectors/nutriscore-vectors.json';
import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { localValidators } from '../../domain/contracts/generated/validate-local';
import { wireValidators } from '../../domain/contracts/generated/validate-wire';
import type { AnalyzeResponse } from '../../domain/contracts/generated/wire';
import { installedResources } from '../../domain/hybrid/resources';
import { replayScientificSnapshot } from '../../domain/pipeline/replay-scientific-snapshot';
import { buildMockAnalyzeResponse } from '../../mocks/backend/responses';
import { ScanSession } from '../scan/scan-session';
import { createAnalysis } from './analysis';

/** Canonical input only: production results come from the real SCI/EVD replay. */
function snapshot(): ProductSnapshot {
  const vector = vectors.vectors[0];
  if (!vector) throw new Error('Canonical general-food input is missing');
  const candidate: unknown = {
    id: 'app-replay-input',
    barcode: '8901030000001',
    name: 'Canonical general food',
    market: 'EU',
    capturedAt: '2026-10-18T12:00:00Z',
    sourceRefs: [
      { id: 'label-source', kind: 'label', title: 'Nutrition panel' },
    ],
    category: 'general',
    scoringFacts: {
      categorySourceIds: ['label-source'],
      cheese: { state: 'absent', sourceIds: ['label-source'] },
      redMeat: { state: 'absent', sourceIds: ['label-source'] },
      plainWater: { state: 'absent', sourceIds: ['label-source'] },
      nonNutritiveSweetener: { state: 'absent', sourceIds: ['label-source'] },
    },
    observations: vector.inputs.observations.map((observation) => ({
      ...observation,
      kind: 'read',
      sourceIds: ['label-source'],
      issues: [],
    })),
    ingredients: [],
    panels: [],
    taxonomyVersion: installedResources().taxonomyVersion,
    evidenceVersion: installedResources().evidenceVersion,
  };
  if (!localValidators.ProductSnapshot(candidate)) {
    throw new Error('App integration input must satisfy the local contract');
  }
  return candidate as ProductSnapshot;
}

const clock = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (id: unknown) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
};

function harness(
  input: ProductSnapshot,
  options: {
    url?: string;
    notice?: string | null;
    delay?: number;
    offline?: boolean;
    mutate?: (response: AnalyzeResponse) => void;
  } = {},
) {
  let calls = 0;
  let notice = options.notice === undefined ? '1-draft' : options.notice;
  const fetch = (_url: string, init: RequestInit): Promise<Response> => {
    calls += 1;
    if (options.offline) return Promise.reject(new Error('offline'));
    const baseResponse = buildMockAnalyzeResponse(String(init.body));
    const replay = replayScientificSnapshot(input);
    const candidate: unknown = {
      ...baseResponse,
      scientific: {
        ...replay.scientific,
        inputSnapshotId: baseResponse.product.id,
      },
      citations: [...replay.citations],
    };
    if (!wireValidators.AnalyzeResponse(candidate)) {
      throw new Error(
        'SCI/EVD replay must satisfy the wire scientific contract',
      );
    }
    const response = candidate as AnalyzeResponse;
    for (const reason of response.scientific.reasons) {
      reason.text = 'UNTRUSTED_SERVER_SENTENCE';
    }
    response.citations = replay.citations.map((citation) => ({
      ...citation,
      title: 'UNTRUSTED_SERVER_TITLE',
    }));
    options.mutate?.(response);
    if (!wireValidators.AnalyzeResponse(response)) {
      throw new Error(
        'Integration transport must return schema-valid wire data',
      );
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      const timer = setTimeout(() => {
        init.signal?.removeEventListener('abort', abort);
        resolve({
          status: 200,
          text: async () => JSON.stringify(response),
        } as Response);
      }, options.delay ?? 100);
      init.signal?.addEventListener('abort', abort, { once: true });
    });
  };
  const composed = createAnalysis(
    { acceptedNoticeVersion: () => notice },
    {
      baseUrl: options.url ?? 'https://analysis.example.invalid',
      fetch,
      clock,
    },
  );
  return {
    ...composed,
    calls: () => calls,
    accept: () => {
      notice = '1-draft';
    },
  };
}

describe('production analysis composition (PIPE-01)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs the installed scientific engine without a configured backend', async () => {
    const input = snapshot();
    const app = harness(input, { url: '' });
    const result = await app.analyser.analyse(
      input,
      new AbortController().signal,
    );
    expect(result.executor).toBe('phone');
    expect(result.assessment.scientific).toMatchObject({
      state: 'graded',
      grade: 'A',
      score: -1,
    });
    expect(localValidators.LocalAssessment(result.assessment)).toBe(true);
    expect(app.hybrid).toBeNull();
    expect(app.calls()).toBe(0);
  });

  it.each(['missing', 'unsupported'] as const)(
    'refuses a guessed grade for %s inputs',
    async (kind) => {
      const input = snapshot();
      if (kind === 'missing') input.observations = [];
      else input.category = 'excluded';
      const app = harness(input, { url: '' });
      const result = await app.analyser.analyse(
        input,
        new AbortController().signal,
      );
      expect(result.assessment.scientific.state).toBe(
        kind === 'missing' ? 'insufficient_data' : 'unsupported',
      );
      expect(result.assessment.scientific).not.toHaveProperty('grade');
    },
  );

  it('uses an eligible backend grade with only real reviewed phone text', async () => {
    const input = snapshot();
    const app = harness(input);
    const running = app.analyser.analyse(input, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(100);
    const result = await running;
    expect(result.executor).toBe('backend');
    expect(result.assessment.scientific).toMatchObject({
      state: 'graded',
      grade: 'A',
      score: -1,
    });
    expect(result.assessment.scientific.reasons).toEqual(
      replayScientificSnapshot(input).scientific.reasons,
    );
    expect(JSON.stringify(result.assessment)).not.toContain('UNTRUSTED_SERVER');
    expect(localValidators.LocalAssessment(result.assessment)).toBe(true);
  });

  it('checks notice acceptance at call time and sends nothing before acceptance', async () => {
    const input = snapshot();
    const app = harness(input, { notice: null });
    const result = await app.analyser.analyse(
      input,
      new AbortController().signal,
    );
    expect(result.executor).toBe('phone');
    expect(result.fallbackIssue?.code).toBe('backend_notice_pending');
    expect(app.calls()).toBe(0);
    app.accept();
    const running = app.analyser.analyse(input, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(100);
    expect((await running).executor).toBe('backend');
    expect(app.calls()).toBe(1);
  });

  it('falls back immediately to a real grade when offline', async () => {
    const input = snapshot();
    const app = harness(input, { offline: true });
    const result = await app.analyser.analyse(
      input,
      new AbortController().signal,
    );
    expect(result.executor).toBe('phone');
    expect(result.fallbackIssue?.code).toBe('backend_offline');
    expect(result.assessment.scientific).toMatchObject({
      grade: 'A',
      score: -1,
    });
  });

  it.each(['grade', 'empty-gap'] as const)(
    'rejects a schema-valid %s mismatch even without server reasons',
    async (kind) => {
      const input = snapshot();
      const app = harness(input, {
        mutate: (response) => {
          if (kind === 'grade' && response.scientific.state === 'graded')
            response.scientific.grade = 'E';
          else
            response.scientific = {
              state: 'insufficient_data',
              inputSnapshotId: response.product.id,
              reasons: [],
              issues: [
                {
                  code: 'nutrition_missing',
                  stage: 'completeness',
                  field: 'nutrition',
                  message: 'UNTRUSTED_SERVER_SENTENCE',
                  action: 'retake',
                },
              ],
            };
        },
      });
      const running = app.analyser.analyse(input, new AbortController().signal);
      await jest.advanceTimersByTimeAsync(100);
      const result = await running;
      expect(result.executor).toBe('phone');
      expect(result.fallbackIssue?.code).toBe('backend_answer_invalid');
      expect(result.assessment.scientific).toMatchObject({
        grade: 'A',
        score: -1,
      });
      expect(await result.lateUpdate).toBeNull();
    },
  );

  it('validates a matching gap through replay and removes server text', async () => {
    const input = snapshot();
    input.observations = [];
    const app = harness(input);
    const running = app.analyser.analyse(input, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(100);
    const result = await running;
    expect(result.executor).toBe('backend');
    expect(result.assessment.scientific.state).toBe('insufficient_data');
    expect(JSON.stringify(result.assessment)).not.toContain('UNTRUSTED_SERVER');
  });

  it('starts real local replay at 2000 ms and opens the late backend update explicitly', async () => {
    const input = snapshot();
    const app = harness(input, { delay: 3500 });
    const session = new ScanSession(
      { lookupBarcode: async () => ({ state: 'found', snapshot: input }) },
      app.analyser,
    );
    const running = session.lookup(input.barcode ?? '8901030000001');
    await jest.advanceTimersByTimeAsync(1999);
    expect(session.getState().lookup.status).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);
    const opened = await running;
    if (opened.status !== 'opened') throw new Error('Phone grade did not open');
    const local = session.getResult(opened.resultKey);
    expect(local?.executor).toBe('phone');
    expect(local?.assessment.scientific).toMatchObject({
      grade: 'A',
      score: -1,
    });
    await jest.advanceTimersByTimeAsync(1500);
    const offered = session.getResult(opened.resultKey);
    expect(offered?.executor).toBe('phone');
    expect(offered?.pendingUpdate?.executor).toBe('backend');
    const updateKey = session.openUpdate(opened.resultKey);
    expect(updateKey).not.toBeNull();
    expect(session.getResult(updateKey ?? '')?.executor).toBe('backend');
    expect(session.getResult(opened.resultKey)?.executor).toBe('phone');
  });

  it('cancels a pending scan without opening a result', async () => {
    const input = snapshot();
    const app = harness(input, { delay: 3500 });
    const session = new ScanSession(
      { lookupBarcode: async () => ({ state: 'found', snapshot: input }) },
      app.analyser,
    );
    const running = session.lookup(input.barcode ?? '8901030000001');
    await jest.advanceTimersByTimeAsync(100);
    session.cancelLookup();
    await jest.advanceTimersByTimeAsync(3500);
    await running;
    expect(session.getState().lookup.status).toBe('idle');
    expect(Object.keys(session.getState().results)).toHaveLength(0);
  });

  it('drops a late offer when leaving the foreground after the local grade', async () => {
    const input = snapshot();
    const app = harness(input, { delay: 3500 });
    const running = app.analyser.analyse(input, new AbortController().signal);
    await jest.advanceTimersByTimeAsync(2000);
    const local = await running;
    app.hybrid?.cancelAll();
    await jest.advanceTimersByTimeAsync(1500);
    expect(await local.lateUpdate).toBeNull();
    expect(local.assessment.scientific).toMatchObject({
      grade: 'A',
      score: -1,
    });
  });
});
