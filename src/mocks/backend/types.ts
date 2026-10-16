import type {
  AnalyzeResponse,
  Health,
  Problem,
} from '../../domain/contracts/generated/wire';

export const ANALYSIS_FALLBACK_START_MS = 2000;
export const ANALYSIS_REQUEST_LIFETIME_MS = 90000;
export const FAST_DELAY_MS = 100;
export const SLOW_DELAY_MS = 3000;
export const LATE_DELAY_MS = 60000;
export const RATE_LIMIT_COOLDOWN_SECONDS = 60;
/** Frozen operating limit from contracts/openapi-hybrid.yaml `maxRequestBytes`. */
export const MAX_REQUEST_BYTES = 262144;

export type MockScenarioName =
  | 'fast'
  | 'slow'
  | 'late'
  | 'offline'
  | 'invalid_request'
  | 'payload_too_large'
  | 'rate_limited'
  | 'unavailable'
  | 'html_wakeup'
  | 'stale_revised_input'
  | 'digest_mismatch'
  | 'edition_mismatch'
  | 'bundle_hash_mismatch';

export interface MockClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
  now(): number;
}

export interface RecordedRequest {
  /** URL the caller supplied. Direct helpers record the route path. */
  readonly url: string;
  readonly path: string;
  readonly method: string;
  /** Header names are lower-case. Values are the ones the caller supplied. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  /**
   * Exact JSON text captured at dispatch. Empty when the body was over
   * MAX_REQUEST_BYTES and was not retained.
   */
  readonly rawBody: string;
  /** UTF-8 size of the body the caller supplied, before any simulated delay. */
  readonly byteLength: number;
  /** Clock time when the mock accepted the call, not when it responded. */
  readonly receivedAt: number;
}

/** Optional caller context for getHealth, postAnalyze and the fetch drop-in. */
export interface MockRequestInit {
  readonly signal?: AbortSignal;
  readonly url?: string;
  readonly headers?: HeadersInit;
}

export interface MockTransportResponse<T = unknown> {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: T;
  readonly ok: boolean;
  readonly rawBody: string;
}

export interface MockBackendOptions {
  readonly scenario?: MockScenarioName;
  readonly clock?: MockClock;
  readonly customDelayMs?: number;
}

export type MockResponseBody = AnalyzeResponse | Health | Problem | string;
