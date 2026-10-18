import type {
  Citation,
  Issue,
  LocalAssessment,
  ProductSnapshot,
  ScientificAssessment,
  ScientificReason,
} from '../../domain/contracts/generated/local';
import { localValidators } from '../../domain/contracts/generated/validate-local';
import { wireValidators } from '../../domain/contracts/generated/validate-wire';
import type { AnalyzeResponse } from '../../domain/contracts/generated/wire';
import { mapAnalyzeResponse } from '../../domain/contracts/map-analyze-response';
import { withLocalIssueCopy } from './backend-issues';
import {
  ANALYSIS_FALLBACK_START_MS,
  ANALYSIS_REQUEST_LIFETIME_MS,
  WARMUP_MIN_INTERVAL_MS,
} from '../../domain/hybrid/constants';
import { checkBackendAnswer } from '../../domain/hybrid/offer';
import { buildAnalyzeRequest } from '../../domain/hybrid/request';
import type { ResourceCompatibility } from '../../domain/hybrid/resources';
import type {
  AnalyserContext,
  AnalysisResult,
  AnalysisUpdate,
  ProductAnalyser,
} from '../../features/scan/analyser';

/**
 * HYB-01: backend-preferred analysis with the phone as fallback (D66–D70,
 * D104).
 *
 * - The request is sent once. If no usable answer arrives within 2000 ms the
 *   phone analysis starts (D69); offline or an explicit failure starts it at
 *   once. There is no automatic retry.
 * - A non-contract answer (HTML, non-JSON, 502/504) is a wake-up signal: the
 *   phone answers and the identical body may be sent once more within the
 *   request's 90 s lifetime.
 * - A backend answer that arrives after the phone result is offered as an
 *   update only if it passes the D70 checks at the moment it is applied.
 * - Nothing is sent before the onboarding notice is accepted, and request
 *   bodies are never logged.
 *
 * The phone analyser is injected; this module imports no local engine.
 */

export interface HybridClock {
  /** Monotonic milliseconds; wall-clock changes must not move deadlines. */
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}

/**
 * D105: reason text shown on the phone comes only from its own reviewed
 * templates, replayed on the same input (EVD-01 renderBackendReasons). The
 * renderer returns null when the phone cannot replay this snapshot; then no
 * server reason is shown.
 */
export type ReasonRenderer = (
  snapshot: ProductSnapshot,
  server: ScientificAssessment,
) => {
  reasons: ScientificReason[];
  citations: Citation[];
  issues: Issue[];
} | null;

export interface HybridAnalyserDeps {
  baseUrl: string;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  local: ProductAnalyser;
  context: AnalyserContext;
  resources: ResourceCompatibility;
  /** When supplied, replay checks every state, including answers without reasons. */
  renderReasons?: ReasonRenderer;
  clock?: HybridClock;
}

export interface HybridAnalyser extends ProductAnalyser {
  /** GET /health on Scan entry, at most once per 10 minutes, no timer. */
  warmUp(): void;
  /** Leaving the foreground: cancel every open request; no offer follows. */
  cancelAll(): void;
}

type Outcome =
  | { kind: 'answer'; response: AnalyzeResponse }
  | { kind: 'wakeup' }
  | { kind: 'failure'; issue: Issue }
  | { kind: 'aborted' };

const systemClock: HybridClock = {
  now: () => performance.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

/** Without Retry-After or retryAfterSeconds, wait the contract example's 60 s. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

function issue(code: string, message: string): Issue {
  return { code, stage: 'method', message, action: 'none' };
}

const ISSUES = {
  notice: () =>
    issue(
      'backend_notice_pending',
      'Product facts go to the analysis server only after the notice is accepted, so this phone analysed them.',
    ),
  offline: () =>
    issue(
      'backend_offline',
      'The analysis server could not be reached, so this phone analysed the product.',
    ),
  rateLimited: () =>
    issue(
      'backend_rate_limited',
      'The analysis server asked the app to wait, so this phone analysed the product.',
    ),
  rejected: () =>
    issue(
      'backend_rejected',
      'The analysis server could not accept these product facts, so this phone analysed them.',
    ),
  tooLarge: () =>
    issue(
      'backend_too_large',
      'The product facts were too large for the analysis server, so this phone analysed them.',
    ),
  unavailable: () =>
    issue(
      'backend_unavailable',
      'The analysis server is unavailable, so this phone analysed the product.',
    ),
  invalidAnswer: () =>
    issue(
      'backend_answer_invalid',
      'The analysis server sent an answer this app cannot check, so this phone analysed the product.',
    ),
  cancelled: () =>
    issue(
      'backend_cancelled',
      'The server request stopped when the app left the screen, so this phone analysed the product.',
    ),
};

function abortError(): Error {
  return new DOMException('Analysis cancelled', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function retryAfterSeconds(response: Response, body: unknown): number {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isInteger(header) && header >= 1) {
    return header;
  }
  const fromBody =
    typeof body === 'object' && body !== null
      ? (body as { retryAfterSeconds?: unknown }).retryAfterSeconds
      : undefined;
  return typeof fromBody === 'number' &&
    Number.isInteger(fromBody) &&
    fromBody >= 1
    ? fromBody
    : DEFAULT_RETRY_AFTER_SECONDS;
}

export function createHybridAnalyser(deps: HybridAnalyserDeps): HybridAnalyser {
  const clock = deps.clock ?? systemClock;
  const base = deps.baseUrl.replace(/\/+$/, '');
  const active = new Set<AbortController>();
  let cooldownUntil = -Infinity;
  let lastWarmUp = -Infinity;

  /** One POST, classified. Never throws. */
  async function post(body: string, signal: AbortSignal): Promise<Outcome> {
    let response: Response;
    try {
      response = await deps.fetch(`${base}/v1/analyses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal,
      });
    } catch (error) {
      return signal.aborted || isAbort(error)
        ? { kind: 'aborted' }
        : { kind: 'failure', issue: ISSUES.offline() };
    }
    if (response.status === 502 || response.status === 504) {
      return { kind: 'wakeup' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text());
    } catch (error) {
      if (signal.aborted || isAbort(error)) {
        return { kind: 'aborted' };
      }
      return { kind: 'wakeup' };
    }
    if (typeof parsed !== 'object' || parsed === null) {
      return { kind: 'wakeup' };
    }
    switch (response.status) {
      case 200:
        return wireValidators.AnalyzeResponse(parsed)
          ? { kind: 'answer', response: parsed as AnalyzeResponse }
          : { kind: 'failure', issue: ISSUES.invalidAnswer() };
      case 429:
        cooldownUntil =
          clock.now() + retryAfterSeconds(response, parsed) * 1000;
        return { kind: 'failure', issue: ISSUES.rateLimited() };
      case 400:
        return { kind: 'failure', issue: ISSUES.rejected() };
      case 413:
        return { kind: 'failure', issue: ISSUES.tooLarge() };
      case 503:
        return { kind: 'failure', issue: ISSUES.unavailable() };
      default:
        return { kind: 'failure', issue: ISSUES.invalidAnswer() };
    }
  }

  /**
   * The backend answer in the phone's own shapes, or null when it cannot be
   * shown safely: it fails mapping, or it carries reasons the phone cannot
   * render from its reviewed templates (D105). Server sentences never reach
   * the screen.
   */
  function toUpdate(
    snapshot: ProductSnapshot,
    response: AnalyzeResponse,
  ): AnalysisUpdate | null {
    try {
      const mapped = mapAnalyzeResponse(response, {
        capturedAt: snapshot.capturedAt,
        panels: snapshot.panels,
        personal: { state: 'not_in_slice', issues: [] },
      });
      // Server sentences never reach the screen; gaps use phone copy.
      let scientific: ScientificAssessment = withLocalIssueCopy({
        ...mapped.assessment.scientific,
        // The digest proved the server analysed this snapshot's product.
        inputSnapshotId: snapshot.id,
      });
      // Server citation titles are server text too; only replayed ones are kept.
      let citations: LocalAssessment['citations'] = [];
      if (deps.renderReasons !== undefined || scientific.reasons.length > 0) {
        const local = deps.renderReasons?.(snapshot, scientific) ?? null;
        if (local === null) {
          return null;
        }
        const [first, ...rest] = local.reasons;
        if (scientific.state === 'graded') {
          if (first === undefined) {
            // A grade without one reviewed reason is not shown.
            return null;
          }
          scientific = {
            ...scientific,
            reasons: [first, ...rest],
            issues: [...scientific.issues, ...local.issues],
          };
        } else {
          scientific = {
            ...scientific,
            reasons: local.reasons,
            issues: [...scientific.issues, ...local.issues],
          };
        }
        citations = local.reasons.length > 0 ? local.citations : [];
      }
      const assessment: LocalAssessment = {
        ...mapped.assessment,
        snapshotId: snapshot.id,
        scientific,
        citations,
      };
      if (!localValidators.LocalAssessment(assessment)) {
        return null;
      }
      // S1 has no personal checks, so a server answer cannot add a hard finding.
      return { assessment, executor: 'backend', introducesHardFinding: false };
    } catch {
      return null;
    }
  }

  async function analyse(
    snapshot: ProductSnapshot,
    signal: AbortSignal,
  ): Promise<AnalysisResult> {
    if (signal.aborted) {
      throw abortError();
    }
    const localOnly = async (
      fallbackIssue: Issue,
    ): Promise<AnalysisResult> => ({
      ...(await deps.local.analyse(snapshot, signal)),
      fallbackIssue,
    });
    if (deps.context.acceptedNoticeVersion() === null) {
      return localOnly(ISSUES.notice());
    }
    if (clock.now() < cooldownUntil) {
      return localOnly(ISSUES.rateLimited());
    }
    const built = buildAnalyzeRequest(snapshot, deps.resources);
    if (!built.ok) {
      return localOnly(built.issue);
    }
    const body = built.body;

    const controller = new AbortController();
    const onScanAbort = () => controller.abort();
    signal.addEventListener('abort', onScanAbort);
    active.add(controller);
    const deadline = clock.now() + ANALYSIS_REQUEST_LIFETIME_MS;
    const lifetime = clock.setTimeout(
      () => controller.abort(),
      ANALYSIS_REQUEST_LIFETIME_MS,
    );
    const finish = () => {
      clock.clearTimeout(lifetime);
      signal.removeEventListener('abort', onScanAbort);
      active.delete(controller);
    };

    return new Promise<AnalysisResult>((resolve, reject) => {
      let localStarted = false;
      let settleLate: (update: AnalysisUpdate | null) => void = () => undefined;
      const lateUpdate = new Promise<AnalysisUpdate | null>((done) => {
        settleLate = done;
      });

      const startLocal = (fallbackIssue?: Issue) => {
        if (localStarted) {
          return;
        }
        localStarted = true;
        clock.clearTimeout(fallbackTimer);
        deps.local.analyse(snapshot, signal).then(
          (result) =>
            resolve({
              ...result,
              ...(fallbackIssue ? { fallbackIssue } : {}),
              lateUpdate,
            }),
          reject,
        );
      };
      const fallbackTimer = clock.setTimeout(
        () => startLocal(),
        ANALYSIS_FALLBACK_START_MS,
      );

      const acceptable = (response: AnalyzeResponse) =>
        checkBackendAnswer({
          sentBody: body,
          response,
          resources: deps.resources,
          scanActive: !signal.aborted && !controller.signal.aborted,
          now: clock.now(),
          deadline,
        }).ok;

      void (async () => {
        let outcome = await post(body, controller.signal);
        if (outcome.kind === 'wakeup') {
          startLocal();
          // The only permitted re-send: identical body, within the lifetime.
          if (clock.now() < deadline && !controller.signal.aborted) {
            outcome = await post(body, controller.signal);
          }
        }

        if (outcome.kind === 'answer') {
          const update = acceptable(outcome.response)
            ? toUpdate(snapshot, outcome.response)
            : null;
          if (!localStarted && update) {
            // Answered in time: the backend result is the result.
            clock.clearTimeout(fallbackTimer);
            localStarted = true;
            resolve({ assessment: update.assessment, executor: 'backend' });
            settleLate(null);
          } else if (!localStarted) {
            startLocal(ISSUES.invalidAnswer());
            settleLate(null);
          } else {
            // Late: offered only if it passed the checks just now (D70).
            settleLate(update);
          }
        } else if (outcome.kind === 'failure') {
          startLocal(outcome.issue);
          settleLate(null);
        } else if (outcome.kind === 'aborted') {
          settleLate(null);
          if (signal.aborted && !localStarted) {
            clock.clearTimeout(fallbackTimer);
            localStarted = true;
            reject(abortError());
          } else {
            startLocal(ISSUES.cancelled());
          }
        } else {
          // A second wake-up: the phone result already stands.
          settleLate(null);
        }
        finish();
      })();
    });
  }

  return {
    analyse,
    warmUp() {
      const now = clock.now();
      if (now - lastWarmUp < WARMUP_MIN_INTERVAL_MS) {
        return;
      }
      lastWarmUp = now;
      deps.fetch(`${base}/health`, { method: 'GET' }).catch(() => undefined);
    },
    cancelAll() {
      for (const controller of active) {
        controller.abort();
      }
    },
  };
}
