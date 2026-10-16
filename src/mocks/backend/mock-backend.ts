import type {
  AnalyzeRequest,
  AnalyzeResponse,
  Health,
  Problem,
} from '../../domain/contracts/generated/wire';
import { wireValidators } from '../../domain/contracts';
import { SystemClock } from './clock';
import { assertNoSensitiveWireData } from './inspection';
import {
  MOCK_HTML_WAKEUP,
  buildMockAnalyzeResponse,
  buildMockHealth,
  buildMockProblem,
  payloadTooLargeMessage,
} from './responses';
import {
  FAST_DELAY_MS,
  LATE_DELAY_MS,
  MAX_REQUEST_BYTES,
  RATE_LIMIT_COOLDOWN_SECONDS,
  SLOW_DELAY_MS,
  type MockBackendOptions,
  type MockClock,
  type MockRequestInit,
  type MockScenarioName,
  type MockTransportResponse,
  type RecordedRequest,
} from './types';

interface StoredRequest {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: string;
  byteLength: number;
  receivedAt: number;
}

interface PreparedCall {
  readonly url: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function declaredContentLength(headers: Record<string, string>): number | null {
  const raw = headers['content-length']?.trim();
  if (raw === undefined || !/^\d+$/.test(raw)) {
    return null;
  }
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : null;
}

function copyHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const copied: Record<string, string> = {};
  if (headers === undefined) {
    return copied;
  }
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      copied[key.toLowerCase()] = value;
    });
    return copied;
  }
  if (Array.isArray(headers)) {
    for (const [key, value] of headers) {
      copied[key.toLowerCase()] = value;
    }
    return copied;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === 'string') {
      copied[key.toLowerCase()] = value;
    }
  }
  return copied;
}

function requestPath(url: string): string {
  try {
    const pathname = new URL(url, 'https://analysis.ingradient.invalid')
      .pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      return pathname.slice(0, -1);
    }
    return pathname;
  } catch {
    return url;
  }
}

function targetUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function isFetchRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== 'undefined' && input instanceof Request;
}

function targetMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) {
    return init.method.toUpperCase();
  }
  if (isFetchRequest(input)) {
    return input.method.toUpperCase();
  }
  return 'GET';
}

function jsonResult<T>(
  status: number,
  body: T,
  extraHeaders?: Record<string, string>,
): MockTransportResponse<T> {
  return {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body,
    ok: status >= 200 && status < 300,
    rawBody: JSON.stringify(body),
  };
}

function invalidRequestResult(): MockTransportResponse<Problem> {
  return jsonResult(
    400,
    buildMockProblem(
      'invalid_request',
      'Request failed wire validation; check required fields.',
    ),
  );
}

function payloadTooLargeResult(): MockTransportResponse<Problem> {
  return jsonResult(
    413,
    buildMockProblem('payload_too_large', payloadTooLargeMessage()),
  );
}

function rateLimitedResult(): MockTransportResponse<Problem> {
  return jsonResult(
    429,
    buildMockProblem(
      'rate_limited',
      'Too many analysis requests; retry after cooldown.',
      RATE_LIMIT_COOLDOWN_SECONDS,
    ),
    { 'retry-after': String(RATE_LIMIT_COOLDOWN_SECONDS) },
  );
}

function unavailableResult(): MockTransportResponse<Problem> {
  return jsonResult(
    503,
    buildMockProblem(
      'unavailable',
      'Backend analysis service is currently unavailable.',
    ),
  );
}

function htmlResult(): MockTransportResponse<string> {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body: MOCK_HTML_WAKEUP,
    ok: true,
    rawBody: MOCK_HTML_WAKEUP,
  };
}

async function readJsonBody(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | null> {
  const body = init?.body;
  if (typeof body === 'string') {
    return body;
  }
  if (body == null) {
    if (isFetchRequest(input)) {
      return input.text();
    }
    return '';
  }
  // Blob, FormData and streams are not analysis JSON. Do not stringify them.
  return null;
}

export class MockBackendTransport {
  private scenario: MockScenarioName;
  private readonly clock: MockClock;
  private readonly customDelayMs?: number;
  private readonly recordedRequests: StoredRequest[] = [];

  constructor(options: MockBackendOptions = {}) {
    this.scenario = options.scenario ?? 'fast';
    this.clock = options.clock ?? new SystemClock();
    this.customDelayMs = options.customDelayMs;
  }

  setScenario(scenario: MockScenarioName): void {
    this.scenario = scenario;
  }

  getScenario(): MockScenarioName {
    return this.scenario;
  }

  getRecordedRequests(): readonly RecordedRequest[] {
    return this.recordedRequests.map((request) => ({ ...request }));
  }

  clearRecordedRequests(): void {
    this.recordedRequests.length = 0;
  }

  assertNoSensitiveData(): void {
    assertNoSensitiveWireData(this);
  }

  private record(request: StoredRequest): StoredRequest {
    this.recordedRequests.push(request);
    return request;
  }

  private prepare(
    fallbackUrl: string,
    fallbackHeaders: Record<string, string>,
    init?: MockRequestInit,
  ): PreparedCall {
    const url = init?.url ?? fallbackUrl;
    return {
      url,
      path: requestPath(url),
      headers:
        init?.headers !== undefined
          ? copyHeaders(init.headers)
          : { ...fallbackHeaders },
      signal: init?.signal,
    };
  }

  private getScenarioDelay(): number {
    if (this.customDelayMs !== undefined) {
      return this.customDelayMs;
    }
    switch (this.scenario) {
      case 'fast':
        return FAST_DELAY_MS;
      case 'slow':
        return SLOW_DELAY_MS;
      case 'late':
        return LATE_DELAY_MS;
      case 'offline':
        return 5;
      case 'invalid_request':
      case 'payload_too_large':
      case 'rate_limited':
      case 'unavailable':
        return 50;
      case 'html_wakeup':
      case 'stale_revised_input':
      case 'digest_mismatch':
      case 'edition_mismatch':
      case 'bundle_hash_mismatch':
        return FAST_DELAY_MS;
    }
  }

  /**
   * Wait on the injected clock. Abort before or during the wait rejects with
   * AbortError, removes the listener, and clears the timer so a later tick
   * cannot resolve the same call.
   */
  private delay(ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(abortError());
    }
    if (ms <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: unknown;
      const onAbort = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        this.clock.clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(abortError());
      };
      timer = this.clock.setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      signal?.addEventListener('abort', onAbort);
    });
  }

  private unreadableBody(call: PreparedCall): MockTransportResponse<Problem> {
    if (call.signal?.aborted) {
      throw abortError();
    }
    this.record({
      url: call.url,
      path: call.path,
      method: 'POST',
      headers: { ...call.headers },
      body: null,
      rawBody: '',
      byteLength: 0,
      receivedAt: this.clock.now(),
    });
    return invalidRequestResult();
  }

  async getHealth(
    init?: MockRequestInit,
  ): Promise<MockTransportResponse<Health | Problem | string>> {
    const call = this.prepare('/health', {}, init);
    if (call.signal?.aborted) {
      throw abortError();
    }
    this.record({
      url: call.url,
      path: call.path,
      method: 'GET',
      headers: { ...call.headers },
      body: null,
      rawBody: '',
      byteLength: 0,
      receivedAt: this.clock.now(),
    });

    await this.delay(this.getScenarioDelay(), call.signal);

    if (this.scenario === 'offline') {
      throw new TypeError('Network request failed');
    }
    if (this.scenario === 'unavailable') {
      return unavailableResult();
    }
    if (this.scenario === 'html_wakeup') {
      return htmlResult();
    }

    const health = buildMockHealth();
    return jsonResult(200, health);
  }

  async postAnalyze(
    request: AnalyzeRequest | string,
    init?: MockRequestInit,
  ): Promise<MockTransportResponse<AnalyzeResponse | Problem | string>> {
    const call = this.prepare(
      '/v1/analyses',
      { 'content-type': 'application/json' },
      init,
    );
    if (call.signal?.aborted) {
      throw abortError();
    }

    const rawBody =
      typeof request === 'string' ? request : JSON.stringify(request);
    const actualBytes = utf8ByteLength(rawBody);
    const declaredBytes = declaredContentLength(call.headers);
    const overDeclared =
      declaredBytes !== null && declaredBytes > MAX_REQUEST_BYTES;
    const overActual = actualBytes > MAX_REQUEST_BYTES;
    const stored = this.record({
      url: call.url,
      path: call.path,
      method: 'POST',
      headers: { ...call.headers },
      body: null,
      rawBody: overActual ? '' : rawBody,
      byteLength: actualBytes,
      receivedAt: this.clock.now(),
    });

    // Size is decided from the captured bytes before parse, delay or a 200.
    if (overActual || overDeclared) {
      return payloadTooLargeResult();
    }

    await this.delay(this.getScenarioDelay(), call.signal);

    if (this.scenario === 'offline') {
      throw new TypeError('Network request failed');
    }
    if (this.scenario === 'rate_limited') {
      return rateLimitedResult();
    }
    if (this.scenario === 'payload_too_large') {
      return payloadTooLargeResult();
    }
    if (this.scenario === 'unavailable') {
      return unavailableResult();
    }
    if (this.scenario === 'html_wakeup') {
      return htmlResult();
    }
    if (this.scenario === 'invalid_request') {
      return invalidRequestResult();
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      return invalidRequestResult();
    }
    // Keep the pre-validation snapshot. Ajv may assign defaults on its copy.
    stored.body = parsed;
    const validationCopy: unknown = JSON.parse(rawBody);
    if (!wireValidators.AnalyzeRequest(validationCopy)) {
      return invalidRequestResult();
    }

    const response = buildMockAnalyzeResponse(rawBody, {
      digestMismatch: this.scenario === 'digest_mismatch',
      editionMismatch: this.scenario === 'edition_mismatch',
      bundleHashMismatch: this.scenario === 'bundle_hash_mismatch',
      staleInput: this.scenario === 'stale_revised_input',
    });
    return jsonResult(200, response);
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = targetUrl(input);
    const method = targetMethod(input, init);
    const signal =
      init?.signal ?? (isFetchRequest(input) ? input.signal : undefined);
    if (signal?.aborted) {
      throw abortError();
    }
    // An omitted header list is empty. Do not invent content-type or drop the URL.
    const headers =
      init?.headers ?? (isFetchRequest(input) ? input.headers : {});
    const call = { url, headers, signal };
    const path = requestPath(url);

    if (path === '/health' && method === 'GET') {
      const res = await this.getHealth(call);
      return new Response(res.rawBody, {
        status: res.status,
        headers: res.headers,
      });
    }

    if (path === '/v1/analyses' && method === 'POST') {
      const rawBody = await readJsonBody(input, init);
      if (signal?.aborted) {
        throw abortError();
      }
      if (rawBody === null) {
        const res = this.unreadableBody(this.prepare('/v1/analyses', {}, call));
        return new Response(res.rawBody, {
          status: res.status,
          headers: res.headers,
        });
      }
      const res = await this.postAnalyze(rawBody, call);
      return new Response(res.rawBody, {
        status: res.status,
        headers: res.headers,
      });
    }

    throw new Error(
      `MockBackendTransport: unhandled mock route ${method} ${url}`,
    );
  }
}

export function createMockBackendTransport(
  options: MockBackendOptions = {},
): MockBackendTransport {
  return new MockBackendTransport(options);
}
