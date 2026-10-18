import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import {
  ANALYSIS_FALLBACK_START_MS,
  ANALYSIS_REQUEST_LIFETIME_MS,
  WARMUP_MIN_INTERVAL_MS,
} from '../../domain/hybrid/constants';
import { EVIDENCE_CITATIONS } from '../../domain/evidence';
import { installedResources } from '../../domain/hybrid/resources';
import {
  methodNotInstalledAnalyser,
  type AnalysisResult,
  type ProductAnalyser,
} from '../../features/scan/analyser';
import { getLocalScenario } from '../../fixtures/scenarios';
import {
  createMockBackendTransport,
  type MockBackendTransport,
} from '../../mocks/backend';
import type { MockScenarioName } from '../../mocks/backend/types';
import {
  createHybridAnalyser,
  type HybridAnalyser,
  type ReasonRenderer,
} from './hybrid-analyser';

const snapshot: ProductSnapshot = getLocalScenario('complete_graded').snapshot;
const resources = installedResources();

/** The server's sentence in the FE-04 mock; it must never reach a result. */
const SERVER_TEXT = 'Moderate sugar contribution to energy density.';
const LOCAL_CITATION = (() => {
  const [first] = EVIDENCE_CITATIONS;
  if (!first) {
    throw new Error('The pinned method bundle has no citations.');
  }
  return first;
})();

/** Test stand-in for the phone replay: reviewed text, local citations. */
const replayRenderer: ReasonRenderer = (_snapshot, server) => ({
  reasons: server.reasons.map((reason) => ({
    ...reason,
    text: 'Reviewed local sentence.',
    citationIds: [LOCAL_CITATION.id],
  })),
  citations: [LOCAL_CITATION],
  issues: [],
});

const clock = {
  now: () => Date.now(),
  setTimeout: (callback: () => void, ms: number) => setTimeout(callback, ms),
  clearTimeout: (id: unknown) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
};

interface Harness {
  hybrid: HybridAnalyser;
  transport: MockBackendTransport;
  localCalls: () => number;
  posts: () => number;
}

function harness(
  scenario: MockScenarioName,
  options: {
    delayMs?: number;
    notice?: string | null;
    renderReasons?: ReasonRenderer | null;
  } = {},
): Harness {
  const transport = createMockBackendTransport({
    scenario,
    ...(options.delayMs !== undefined
      ? { customDelayMs: options.delayMs }
      : {}),
  });
  let calls = 0;
  const local: ProductAnalyser = {
    analyse(input, signal) {
      calls += 1;
      return methodNotInstalledAnalyser.analyse(input, signal);
    },
  };
  const notice = options.notice === undefined ? '1-draft' : options.notice;
  const hybrid = createHybridAnalyser({
    baseUrl: 'https://analysis.example.invalid/',
    fetch: (input, init) => transport.fetch(input, init),
    local,
    context: { acceptedNoticeVersion: () => notice },
    resources,
    ...(options.renderReasons === null
      ? {}
      : { renderReasons: options.renderReasons ?? replayRenderer }),
    clock,
  });
  return {
    hybrid,
    transport,
    localCalls: () => calls,
    posts: () =>
      transport
        .getRecordedRequests()
        .filter((request) => request.method === 'POST').length,
  };
}

/** Starts an analysis and records when it settles. */
function start(h: Harness, signal = new AbortController().signal) {
  const state: { result?: AnalysisResult; error?: unknown } = {};
  const promise = h.hybrid.analyse(snapshot, signal).then(
    (result) => {
      state.result = result;
      return result;
    },
    (error: unknown) => {
      state.error = error;
      throw error;
    },
  );
  promise.catch(() => undefined);
  return { state, promise };
}

describe('hybrid analysis client (HYB-01)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('sends one product-only request and uses an in-time backend answer', async () => {
    const h = harness('fast');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(150);
    expect(run.state.result?.executor).toBe('backend');
    expect(run.state.result?.assessment.snapshotId).toBe(snapshot.id);
    expect(h.localCalls()).toBe(0);
    expect(h.posts()).toBe(1);
    const [request] = h.transport.getRecordedRequests();
    expect(request?.url).toBe('https://analysis.example.invalid/v1/analyses');
    expect(Object.keys(request?.headers ?? {})).toEqual(['content-type']);
    h.transport.assertNoSensitiveData();
    await jest.advanceTimersByTimeAsync(ANALYSIS_REQUEST_LIFETIME_MS);
    expect(h.posts()).toBe(1);
  });

  it('starts the phone at 2000 ms and offers the late answer (D69, D70)', async () => {
    const h = harness('slow');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(ANALYSIS_FALLBACK_START_MS - 1);
    expect(h.localCalls()).toBe(0);
    expect(run.state.result).toBeUndefined();
    await jest.advanceTimersByTimeAsync(1);
    expect(h.localCalls()).toBe(1);
    expect(run.state.result?.executor).toBe('phone');
    const late = run.state.result?.lateUpdate;
    expect(late).toBeDefined();
    await jest.advanceTimersByTimeAsync(1500);
    const update = await late;
    expect(update?.executor).toBe('backend');
    expect(update?.assessment.scientific.state).toBe('graded');
    expect(update?.introducesHardFinding).toBe(false);
  });

  it('falls back at once when offline', async () => {
    const h = harness('offline');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(10);
    expect(run.state.result?.executor).toBe('phone');
    expect(run.state.result?.fallbackIssue?.code).toBe('backend_offline');
    expect(await run.state.result?.lateUpdate).toBeNull();
  });

  const failures: [MockScenarioName, string][] = [
    ['invalid_request', 'backend_rejected'],
    ['payload_too_large', 'backend_too_large'],
    ['unavailable', 'backend_unavailable'],
    ['rate_limited', 'backend_rate_limited'],
  ];
  it.each(failures)(
    'falls back at once on %s with a named issue',
    async (scenario, code) => {
      const h = harness(scenario);
      const run = start(h);
      await jest.advanceTimersByTimeAsync(60);
      expect(h.localCalls()).toBe(1);
      expect(run.state.result?.fallbackIssue?.code).toBe(code);
      expect(await run.state.result?.lateUpdate).toBeNull();
      expect(h.posts()).toBe(1);
    },
  );

  it('honours Retry-After before sending again', async () => {
    const h = harness('rate_limited');
    start(h);
    await jest.advanceTimersByTimeAsync(60);
    expect(h.posts()).toBe(1);

    h.transport.setScenario('fast');
    const cooling = start(h);
    await jest.advanceTimersByTimeAsync(10);
    expect(h.posts()).toBe(1);
    expect(cooling.state.result?.fallbackIssue?.code).toBe(
      'backend_rate_limited',
    );

    await jest.advanceTimersByTimeAsync(60_000);
    const after = start(h);
    await jest.advanceTimersByTimeAsync(150);
    expect(h.posts()).toBe(2);
    expect(after.state.result?.executor).toBe('backend');
  });

  it('treats an HTML answer as wake-up: phone now, one identical re-send', async () => {
    const h = harness('html_wakeup');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(150);
    expect(run.state.result?.executor).toBe('phone');
    expect(run.state.result?.fallbackIssue).toBeUndefined();
    await jest.advanceTimersByTimeAsync(ANALYSIS_REQUEST_LIFETIME_MS);
    const posts = h.transport
      .getRecordedRequests()
      .filter((request) => request.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[1]?.rawBody).toBe(posts[0]?.rawBody);
    expect(await run.state.result?.lateUpdate).toBeNull();
  });

  it('offers a re-sent answer that arrives after a wake-up', async () => {
    const h = harness('html_wakeup');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(110);
    h.transport.setScenario('slow');
    await jest.advanceTimersByTimeAsync(3500);
    const update = await run.state.result?.lateUpdate;
    expect(update?.executor).toBe('backend');
  });

  it.each([
    'digest_mismatch',
    'stale_revised_input',
    'edition_mismatch',
    'bundle_hash_mismatch',
  ] as const)('never uses or offers an answer with %s', async (scenario) => {
    const inTime = harness(scenario);
    const first = start(inTime);
    await jest.advanceTimersByTimeAsync(150);
    expect(first.state.result?.executor).toBe('phone');
    expect(first.state.result?.fallbackIssue?.code).toBe(
      'backend_answer_invalid',
    );

    const late = harness(scenario, { delayMs: 5000 });
    const second = start(late);
    await jest.advanceTimersByTimeAsync(ANALYSIS_FALLBACK_START_MS);
    expect(second.state.result?.executor).toBe('phone');
    await jest.advanceTimersByTimeAsync(5000);
    expect(await second.state.result?.lateUpdate).toBeNull();
  });

  it('drops the late answer when the app leaves the foreground', async () => {
    const h = harness('slow');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(ANALYSIS_FALLBACK_START_MS);
    h.hybrid.cancelAll();
    await jest.advanceTimersByTimeAsync(2000);
    expect(await run.state.result?.lateUpdate).toBeNull();
  });

  it('answers on the phone if cancelled by leaving before the fallback', async () => {
    const h = harness('slow');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(500);
    h.hybrid.cancelAll();
    await jest.advanceTimersByTimeAsync(10);
    expect(run.state.result?.executor).toBe('phone');
    expect(run.state.result?.fallbackIssue?.code).toBe('backend_cancelled');
  });

  it('rejects when the scan itself is cancelled before any answer', async () => {
    const h = harness('slow');
    const scan = new AbortController();
    const run = start(h, scan.signal);
    await jest.advanceTimersByTimeAsync(500);
    scan.abort();
    await jest.advanceTimersByTimeAsync(10);
    expect((run.state.error as Error | undefined)?.name).toBe('AbortError');
    expect(h.localCalls()).toBe(0);
  });

  it('gives no offer after the scan is cancelled once the phone answered', async () => {
    const h = harness('slow');
    const scan = new AbortController();
    const run = start(h, scan.signal);
    await jest.advanceTimersByTimeAsync(ANALYSIS_FALLBACK_START_MS);
    scan.abort();
    await jest.advanceTimersByTimeAsync(2000);
    expect(await run.state.result?.lateUpdate).toBeNull();
  });

  it('closes the request at the 90 s lifetime with no offer', async () => {
    const h = harness('fast', { delayMs: ANALYSIS_REQUEST_LIFETIME_MS + 5000 });
    const run = start(h);
    await jest.advanceTimersByTimeAsync(ANALYSIS_REQUEST_LIFETIME_MS + 6000);
    expect(run.state.result?.executor).toBe('phone');
    expect(await run.state.result?.lateUpdate).toBeNull();
    expect(h.posts()).toBe(1);
  });

  it('sends nothing before the notice is accepted (case 6)', async () => {
    const h = harness('fast', { notice: null });
    const run = start(h);
    await jest.advanceTimersByTimeAsync(10);
    expect(h.posts()).toBe(0);
    expect(run.state.result?.executor).toBe('phone');
    expect(run.state.result?.fallbackIssue?.code).toBe(
      'backend_notice_pending',
    );
  });

  it('pings health at most once per 10 minutes, with no timer', async () => {
    const h = harness('fast');
    const gets = () =>
      h.transport
        .getRecordedRequests()
        .filter((request) => request.method === 'GET').length;
    h.hybrid.warmUp();
    h.hybrid.warmUp();
    await jest.advanceTimersByTimeAsync(WARMUP_MIN_INTERVAL_MS - 1);
    h.hybrid.warmUp();
    expect(gets()).toBe(1);
    await jest.advanceTimersByTimeAsync(WARMUP_MIN_INTERVAL_MS * 3);
    expect(gets()).toBe(1);
    h.hybrid.warmUp();
    expect(gets()).toBe(2);
    expect(h.transport.getRecordedRequests()[0]?.path).toBe('/health');
  });
  it('shows only phone-rendered reasons and citations from the backend (D105)', async () => {
    const h = harness('fast');
    const run = start(h);
    await jest.advanceTimersByTimeAsync(150);
    const result = run.state.result;
    expect(result?.executor).toBe('backend');
    expect(JSON.stringify(result?.assessment)).not.toContain(SERVER_TEXT);
    expect(result?.assessment.scientific.reasons[0]?.text).toBe(
      'Reviewed local sentence.',
    );
    expect(result?.assessment.citations).toEqual([LOCAL_CITATION]);
  });

  it('never uses a reasoned answer the phone cannot replay', async () => {
    const none = harness('fast', { renderReasons: null });
    const first = start(none);
    await jest.advanceTimersByTimeAsync(150);
    expect(first.state.result?.executor).toBe('phone');
    expect(first.state.result?.fallbackIssue?.code).toBe(
      'backend_answer_invalid',
    );

    const refusing = harness('slow', { renderReasons: () => null });
    const second = start(refusing);
    await jest.advanceTimersByTimeAsync(ANALYSIS_FALLBACK_START_MS + 1500);
    expect(await second.state.result?.lateUpdate).toBeNull();
  });

  it('never shows a grade whose reasons all fail the replay', async () => {
    const h = harness('fast', {
      renderReasons: () => ({
        reasons: [],
        citations: [],
        issues: [
          {
            code: 'unknown_reason_template',
            stage: 'method',
            message: 'A reviewed reason template is unavailable.',
            action: 'read_source',
          },
        ],
      }),
    });
    const run = start(h);
    await jest.advanceTimersByTimeAsync(150);
    expect(run.state.result?.executor).toBe('phone');
  });
});
