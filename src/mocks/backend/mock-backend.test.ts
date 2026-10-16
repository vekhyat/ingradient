/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  inputDigest,
  inputDigestOfRequestBody,
  wireValidators,
} from '../../domain/contracts';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  Health,
  Problem,
} from '../../domain/contracts/generated/wire';
import {
  ANALYSIS_FALLBACK_START_MS,
  ANALYSIS_REQUEST_LIFETIME_MS,
  FAST_DELAY_MS,
  LATE_DELAY_MS,
  MAX_REQUEST_BYTES,
  ManualClock,
  RATE_LIMIT_COOLDOWN_SECONDS,
  SLOW_DELAY_MS,
  assertNoSensitiveWireData,
  createMockBackendTransport,
} from './index';

function sampleAnalyzeRequest(): AnalyzeRequest {
  return {
    contractVersion: '0.2.0-draft',
    product: {
      barcode: '8901030000001',
      name: 'Oat Crunch Cereal',
      market: 'IN',
      ingredientsText: 'Whole grain oats, sugar, sunflower oil, sea salt',
      ingredientsStatus: 'complete',
      observations: [
        {
          field: 'energy',
          kind: 'read',
          value: 1600,
          unit: 'kJ',
          basis: 'per_100_g',
          sourceIds: ['src-0'],
          issues: [],
        },
        {
          field: 'sugars',
          kind: 'read',
          value: 12,
          unit: 'g',
          basis: 'per_100_g',
          sourceIds: ['src-0'],
          issues: [],
        },
      ],
      sourceRefs: [
        {
          id: 'src-0',
          kind: 'label',
          title: 'Combined label photo',
        },
      ],
      issues: [],
    },
    resourceCompatibility: {
      taxonomyVersion: 'fictional-taxonomy',
      evidenceVersion: 'fictional-evidence',
      methodEdition: 'faq-v11-2025-03-17',
      methodBundleSha256:
        '0000000000000000000000000000000000000000000000000000000000000000',
    },
  };
}

describe('MockBackendTransport (FE-04)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('Scenario 1: fast (100 ms)', () => {
    it('returns valid AnalyzeResponse with dynamically computed inputDigest in 100 ms', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const req = sampleAnalyzeRequest();
      const expectedDigest = inputDigest(req.product);

      let settled = false;
      const startedAt = Date.now();
      const promise = transport.postAnalyze(req).then((response) => {
        settled = true;
        return response;
      });
      const recordedAtDispatch = transport.getRecordedRequests()[0];
      expect(recordedAtDispatch?.receivedAt).toBe(startedAt);
      expect(recordedAtDispatch?.rawBody).toContain('Oat Crunch Cereal');

      // The settlement flag is attached before time moves. A then() added
      // after the promise resolved would still read false until a later turn.
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS - 1);
      expect(settled).toBe(false);
      expect(transport.getRecordedRequests()[0]?.receivedAt).toBe(startedAt);

      await jest.advanceTimersByTimeAsync(1);
      const res = await promise;

      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);

      const body = res.body as AnalyzeResponse;
      expect(wireValidators.AnalyzeResponse(body)).toBe(true);
      expect(body.inputDigest).toBe(expectedDigest);
      expect(body.product.id).toBe(body.scientific.inputSnapshotId);
      expect(transport.getRecordedRequests()).toHaveLength(1);
      expect(transport.getRecordedRequests()[0]?.path).toBe('/v1/analyses');

      transport.assertNoSensitiveData();
    });

    it('computes inputDigest from raw JSON request body via inputDigestOfRequestBody', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const req = sampleAnalyzeRequest();
      const reqString = JSON.stringify(req);
      const expectedDigest = inputDigestOfRequestBody(reqString);

      const promise = transport.postAnalyze(reqString);
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      const res = await promise;

      const body = res.body as AnalyzeResponse;
      expect(body.inputDigest).toBe(expectedDigest);
    });
  });

  describe('Scenario 2: slow (3 s, exceeds 2 s fallback start)', () => {
    it('resolves after 3000 ms, which exceeds ANALYSIS_FALLBACK_START_MS (2000 ms)', async () => {
      expect(SLOW_DELAY_MS).toBeGreaterThan(ANALYSIS_FALLBACK_START_MS);
      expect(SLOW_DELAY_MS).toBe(3000);

      const transport = createMockBackendTransport({ scenario: 'slow' });
      const req = sampleAnalyzeRequest();
      let settled = false;
      const promise = transport.postAnalyze(req).then((response) => {
        settled = true;
        return response;
      });

      await jest.advanceTimersByTimeAsync(ANALYSIS_FALLBACK_START_MS);
      expect(settled).toBe(false);

      // Completes at 3000 ms
      await jest.advanceTimersByTimeAsync(
        SLOW_DELAY_MS - ANALYSIS_FALLBACK_START_MS,
      );
      const res = await promise;

      expect(res.status).toBe(200);
      expect(wireValidators.AnalyzeResponse(res.body)).toBe(true);
    });
  });

  describe('Scenario 3: late (60 s, inside 90 s lifetime)', () => {
    it('resolves at 60000 ms, within ANALYSIS_REQUEST_LIFETIME_MS (90000 ms)', async () => {
      expect(LATE_DELAY_MS).toBeLessThan(ANALYSIS_REQUEST_LIFETIME_MS);
      expect(LATE_DELAY_MS).toBe(60000);

      const transport = createMockBackendTransport({ scenario: 'late' });
      const req = sampleAnalyzeRequest();
      let settled = false;
      const promise = transport.postAnalyze(req).then((response) => {
        settled = true;
        return response;
      });

      await jest.advanceTimersByTimeAsync(30000);
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(30000);
      const res = await promise;

      expect(res.status).toBe(200);
      expect(wireValidators.AnalyzeResponse(res.body)).toBe(true);
    });
  });

  describe('Scenario 4: offline', () => {
    it('rejects with TypeError Network request failed', async () => {
      const transport = createMockBackendTransport({ scenario: 'offline' });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());

      // Attaching catch handler avoids unhandled rejection when advancing timers
      const rejectionPromise = expect(promise).rejects.toThrow(
        /Network request failed/,
      );
      await jest.advanceTimersByTimeAsync(10);
      await rejectionPromise;
    });
  });

  describe('Scenario 5: invalid_request (400)', () => {
    it('returns status 400 Problem validating against wireValidators.Problem', async () => {
      const transport = createMockBackendTransport({
        scenario: 'invalid_request',
      });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(400);
      expect(res.ok).toBe(false);
      const problem = res.body as Problem;
      expect(wireValidators.Problem(problem)).toBe(true);
      expect(problem.code).toBe('invalid_request');
    });
  });

  describe('Scenario 6: payload_too_large (413)', () => {
    it('returns status 413 Problem validating against wireValidators.Problem', async () => {
      const transport = createMockBackendTransport({
        scenario: 'payload_too_large',
      });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(413);
      expect(res.ok).toBe(false);
      const problem = res.body as Problem;
      expect(wireValidators.Problem(problem)).toBe(true);
      expect(problem.code).toBe('payload_too_large');
      expect(problem.message).toContain(String(MAX_REQUEST_BYTES));
      expect(problem.message).not.toContain('64 KiB');
    });
  });

  describe('Scenario 7: rate_limited (429)', () => {
    it('returns status 429 Problem with Retry-After header', async () => {
      const transport = createMockBackendTransport({
        scenario: 'rate_limited',
      });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(429);
      expect(res.ok).toBe(false);
      expect(res.headers['retry-after']).toBe(
        String(RATE_LIMIT_COOLDOWN_SECONDS),
      );
      const problem = res.body as Problem;
      expect(wireValidators.Problem(problem)).toBe(true);
      expect(problem.code).toBe('rate_limited');
      expect(problem.retryAfterSeconds).toBe(RATE_LIMIT_COOLDOWN_SECONDS);
    });
  });

  describe('Scenario 8: unavailable (503)', () => {
    it('returns status 503 Problem validating against wireValidators.Problem', async () => {
      const transport = createMockBackendTransport({
        scenario: 'unavailable',
      });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(503);
      expect(res.ok).toBe(false);
      const problem = res.body as Problem;
      expect(wireValidators.Problem(problem)).toBe(true);
      expect(problem.code).toBe('unavailable');
    });
  });

  describe('Scenario 9: html_wakeup', () => {
    it('returns non-contract HTML body with text/html content-type', async () => {
      const transport = createMockBackendTransport({
        scenario: 'html_wakeup',
      });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(typeof res.body).toBe('string');
      expect(res.body as string).toContain('<!DOCTYPE html>');
      // Confirms this response deliberately does not validate as JSON wire AnalyzeResponse
      expect(wireValidators.AnalyzeResponse(res.body)).toBe(false);
    });

    it('follows setScenario at completion, so one wake-up can be retried as success', async () => {
      const transport = createMockBackendTransport({
        scenario: 'html_wakeup',
      });
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      transport.setScenario('fast');
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      const res = await promise;

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
      expect(wireValidators.AnalyzeResponse(res.body)).toBe(true);
    });
  });

  describe('Scenario 10: stale_revised_input', () => {
    it('returns valid AnalyzeResponse for different product whose digest does not match active request', async () => {
      const transport = createMockBackendTransport({
        scenario: 'stale_revised_input',
      });
      const req = sampleAnalyzeRequest();
      const activeDigest = inputDigest(req.product);

      const promise = transport.postAnalyze(req);
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(200);
      const body = res.body as AnalyzeResponse;
      expect(wireValidators.AnalyzeResponse(body)).toBe(true);
      // Valid response body, but stale input digest
      expect(body.inputDigest).not.toBe(activeDigest);
      expect(body.product.name).toBe('Stale Formulation Cola');
    });
  });

  describe('Scenario 11: digest_mismatch', () => {
    it('returns valid AnalyzeResponse but with mismatched inputDigest', async () => {
      const transport = createMockBackendTransport({
        scenario: 'digest_mismatch',
      });
      const req = sampleAnalyzeRequest();
      const activeDigest = inputDigest(req.product);

      const promise = transport.postAnalyze(req);
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(200);
      const body = res.body as AnalyzeResponse;
      expect(wireValidators.AnalyzeResponse(body)).toBe(true);
      expect(body.inputDigest).not.toBe(activeDigest);
      expect(body.inputDigest).toBe(
        '0000000000000000000000000000000000000000000000000000000000000000',
      );
    });
  });

  describe('Scenario 12: edition_mismatch & bundle_hash_mismatch', () => {
    it('edition_mismatch returns outdated method edition', async () => {
      const transport = createMockBackendTransport({
        scenario: 'edition_mismatch',
      });
      const req = sampleAnalyzeRequest();

      const promise = transport.postAnalyze(req);
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(200);
      const body = res.body as AnalyzeResponse;
      expect(wireValidators.AnalyzeResponse(body)).toBe(true);
      expect(body.scientific.state).toBe('graded');
      if (body.scientific.state !== 'graded') {
        return;
      }
      expect(body.scientific.method.edition).toBe('faq-v10-2023-outdated');
      expect(body.scientific.method.edition).not.toBe(
        req.resourceCompatibility.methodEdition,
      );
      expect(body.product.taxonomyVersion).toBe(
        req.resourceCompatibility.taxonomyVersion,
      );
      expect(body.product.evidenceVersion).toBe(
        req.resourceCompatibility.evidenceVersion,
      );
    });

    it('bundle_hash_mismatch returns mismatched method bundleSha256', async () => {
      const transport = createMockBackendTransport({
        scenario: 'bundle_hash_mismatch',
      });
      const req = sampleAnalyzeRequest();

      const promise = transport.postAnalyze(req);
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(200);
      const body = res.body as AnalyzeResponse;
      expect(wireValidators.AnalyzeResponse(body)).toBe(true);
      expect(body.scientific.state).toBe('graded');
      if (body.scientific.state !== 'graded') {
        return;
      }
      expect(body.scientific.method.bundleSha256).toBe(
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      );
      expect(body.scientific.method.bundleSha256).not.toBe(
        req.resourceCompatibility.methodBundleSha256,
      );
    });
  });

  describe('GET /health route', () => {
    it('returns status 200 Health payload validating against wireValidators.Health', async () => {
      const transport = createMockBackendTransport();
      const promise = transport.getHealth();
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(200);
      expect(res.ok).toBe(true);
      const health = res.body as Health;
      expect(wireValidators.Health(health)).toBe(true);
      expect(health.status).toBe('ok');
      expect(health.contractVersion).toBe('0.2.0-draft');
    });

    it('respects unavailable scenario on health route', async () => {
      const transport = createMockBackendTransport({
        scenario: 'unavailable',
      });
      const promise = transport.getHealth();
      await jest.advanceTimersByTimeAsync(100);
      const res = await promise;

      expect(res.status).toBe(503);
      expect(wireValidators.Problem(res.body)).toBe(true);
    });
  });

  describe('standard fetch compatibility', () => {
    it('handles GET /health via transport.fetch', async () => {
      const transport = createMockBackendTransport();
      const promise = transport.fetch(
        'https://analysis.ingradient.invalid/health',
      );
      await jest.advanceTimersByTimeAsync(100);
      const response = await promise;

      expect(response.status).toBe(200);
      const data = (await response.json()) as Health;
      expect(wireValidators.Health(data)).toBe(true);
    });

    it('handles POST /v1/analyses via transport.fetch', async () => {
      const transport = createMockBackendTransport();
      const req = sampleAnalyzeRequest();
      const promise = transport.fetch(
        'https://analysis.ingradient.invalid/v1/analyses',
        {
          method: 'POST',
          body: JSON.stringify(req),
        },
      );
      await jest.advanceTimersByTimeAsync(100);
      const response = await promise;

      expect(response.status).toBe(200);
      const data = (await response.json()) as AnalyzeResponse;
      expect(wireValidators.AnalyzeResponse(data)).toBe(true);
      expect(data.inputDigest).toBe(inputDigest(req.product));
    });
  });

  describe('injected ManualClock', () => {
    it('allows deterministic timer advancement without Jest fake timers', async () => {
      jest.useRealTimers();
      const manualClock = new ManualClock();
      const transport = createMockBackendTransport({
        scenario: 'fast',
        clock: manualClock,
      });

      let settled = false;
      const promise = transport
        .postAnalyze(sampleAnalyzeRequest())
        .then((response) => {
          settled = true;
          return response;
        });

      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      manualClock.advanceBy(50);
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);

      manualClock.advanceBy(50);
      const res = await promise;
      expect(res.status).toBe(200);
    });
  });

  describe('Inspection helper (assertNoSensitiveWireData)', () => {
    it('passes cleanly when requests contain only documented wire fields', () => {
      const req = sampleAnalyzeRequest();
      expect(() => assertNoSensitiveWireData(req)).not.toThrow();
    });

    it('rejects top-level personal profile field', () => {
      const invalid = {
        ...sampleAnalyzeRequest(),
        profile: {
          dietaryPractice: 'vegan',
          allergies: ['peanuts'],
        },
      };
      expect(() => assertNoSensitiveWireData(invalid)).toThrow(
        /Wire privacy violation: Disallowed sensitive field "profile"/,
      );
    });

    it('rejects imageBase64 field', () => {
      const invalid = {
        ...sampleAnalyzeRequest(),
        imageBase64: 'data:image/jpeg;base64,...',
      };
      expect(() => assertNoSensitiveWireData(invalid)).toThrow(
        /Wire privacy violation: Disallowed sensitive field "imageBase64"/,
      );
    });

    it('rejects accountId field', () => {
      const invalid = {
        ...sampleAnalyzeRequest(),
        accountId: 'acc-12345',
      };
      expect(() => assertNoSensitiveWireData(invalid)).toThrow(
        /Wire privacy violation: Disallowed sensitive field "accountId"/,
      );
    });

    it('rejects deviceId field', () => {
      const invalid = {
        ...sampleAnalyzeRequest(),
        deviceId: 'device-xyz',
      };
      expect(() => assertNoSensitiveWireData(invalid)).toThrow(
        /Wire privacy violation: Disallowed sensitive field "deviceId"/,
      );
    });

    it('rejects nested product images', () => {
      const invalid = {
        ...sampleAnalyzeRequest(),
        product: {
          ...sampleAnalyzeRequest().product,
          images: [{ id: 'img-1' }],
        },
      };
      expect(() => assertNoSensitiveWireData(invalid)).toThrow(
        /Wire privacy violation: Disallowed sensitive field "images"/,
      );
    });

    it('rejects hidden installation id in sourceRefs', () => {
      const invalid = {
        ...sampleAnalyzeRequest(),
        product: {
          ...sampleAnalyzeRequest().product,
          sourceRefs: [
            {
              id: 'expo-install-3f2a9c',
              kind: 'label',
              title: 'Ingredient panel',
            },
          ],
        },
      };
      expect(() => assertNoSensitiveWireData(invalid)).toThrow(
        /Wire privacy violation: Disallowed pattern "\/expo-install\/i"/,
      );
      try {
        assertNoSensitiveWireData(invalid);
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        expect(message).not.toContain('3f2a9c');
      }
    });

    it('inspects transport instance via assertNoSensitiveData()', async () => {
      const transport = createMockBackendTransport();
      const promise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(100);
      await promise;

      expect(() => transport.assertNoSensitiveData()).not.toThrow();
    });
  });

  describe('capture, digest and privacy regressions', () => {
    it('hashes the JSON text of an object request, not a later mutation', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const req = sampleAnalyzeRequest();
      const sent = JSON.stringify(req);
      let settled = false;
      const promise = transport.postAnalyze(req).then((response) => {
        settled = true;
        return response;
      });
      req.product.name = 'Mutated after dispatch';

      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS - 1);
      expect(settled).toBe(false);

      await jest.advanceTimersByTimeAsync(1);
      const res = await promise;
      const recorded = transport.getRecordedRequests()[0];
      const body = res.body as AnalyzeResponse;

      expect(recorded?.rawBody).toBe(sent);
      expect(recorded?.rawBody).not.toContain('Mutated after dispatch');
      expect(body.inputDigest).toBe(inputDigestOfRequestBody(sent));
      expect(body.inputDigest).not.toBe(inputDigest(req.product));
    });

    it('drops undefined object fields through JSON.stringify before hashing', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const req = sampleAnalyzeRequest();
      const live: AnalyzeRequest & { dropped?: undefined } = { ...req };
      live.dropped = undefined;
      const promise = transport.postAnalyze(live);
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      const res = await promise;
      const recorded = transport.getRecordedRequests()[0];

      expect(recorded?.rawBody).not.toContain('dropped');
      expect((res.body as AnalyzeResponse).inputDigest).toBe(
        inputDigestOfRequestBody(recorded?.rawBody ?? ''),
      );
    });

    it('keeps a health warm-up plus a valid POST inside the privacy check', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const healthUrl = 'https://analysis.ingradient.invalid/health';
      const analyzeUrl = 'https://analysis.ingradient.invalid/v1/analyses';
      const healthPromise = transport.fetch(healthUrl);
      const postPromise = transport.fetch(analyzeUrl, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sampleAnalyzeRequest()),
      });

      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      const health = await healthPromise;
      const post = await postPromise;
      const [healthCall, postCall] = transport.getRecordedRequests();

      expect(health.status).toBe(200);
      expect(post.status).toBe(200);
      expect(healthCall?.url).toBe(healthUrl);
      expect(healthCall?.method).toBe('GET');
      expect(healthCall?.headers).toEqual({});
      expect(healthCall?.body).toBeNull();
      expect(postCall?.url).toBe(analyzeUrl);
      expect(postCall?.headers).toEqual({
        accept: 'application/json',
        'content-type': 'application/json',
      });
      expect(() => transport.assertNoSensitiveData()).not.toThrow();
      expect(() =>
        assertNoSensitiveWireData(transport.getRecordedRequests()),
      ).not.toThrow();
    });

    it('rejects forbidden header and query values without repeating them', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const secretHeader = 'acct-secret-9f3c';
      const promise = transport.fetch(
        'https://analysis.ingradient.invalid/v1/analyses',
        {
          method: 'POST',
          headers: { 'X-Account-Id': secretHeader },
          body: JSON.stringify(sampleAnalyzeRequest()),
        },
      );
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      await promise;

      let message = '';
      try {
        transport.assertNoSensitiveData();
      } catch (error) {
        message = error instanceof Error ? error.message : '';
      }
      expect(message).toMatch(/Disallowed header "x-account-id"/);
      expect(message).not.toContain(secretHeader);

      const traced = createMockBackendTransport({ scenario: 'fast' });
      const tracedPromise = traced.fetch(
        'https://analysis.ingradient.invalid/v1/analyses',
        {
          method: 'POST',
          headers: { 'X-Trace': 'expo-install-3f2a9c' },
          body: JSON.stringify(sampleAnalyzeRequest()),
        },
      );
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      await tracedPromise;
      let tracedMessage = '';
      try {
        traced.assertNoSensitiveData();
      } catch (error) {
        tracedMessage = error instanceof Error ? error.message : '';
      }
      expect(tracedMessage).toMatch(/Disallowed pattern "\/expo-install\/i"/);
      expect(tracedMessage).not.toContain('3f2a9c');

      const queryOnly = createMockBackendTransport({ scenario: 'fast' });
      const secretQuery = 'device-secret-9f3c';
      const healthPromise = queryOnly.fetch(
        `https://analysis.ingradient.invalid/health?sessionId=${secretQuery}`,
      );
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      await healthPromise;
      let queryMessage = '';
      try {
        queryOnly.assertNoSensitiveData();
      } catch (error) {
        queryMessage = error instanceof Error ? error.message : '';
      }
      expect(queryMessage).toMatch(/Disallowed query parameter "sessionId"/);
      expect(queryMessage).not.toContain(secretQuery);
    });
  });

  describe('contract rejection before a 200', () => {
    const openapi = readFileSync(
      join(__dirname, '..', '..', '..', 'contracts', 'openapi-hybrid.yaml'),
      'utf8',
    );
    const wireNegatives = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'contracts', 'negative', 'wire.json'),
        'utf8',
      ),
    ) as readonly { schema: string; name: string; value: unknown }[];

    it('locks timer and size constants to the frozen contract text', () => {
      expect(openapi).toContain('analysisFallbackStartMs: 2000');
      expect(ANALYSIS_FALLBACK_START_MS).toBe(2000);
      expect(openapi).toContain('analysisRequestLifetimeMs: 90000');
      expect(ANALYSIS_REQUEST_LIFETIME_MS).toBe(90000);
      expect(openapi).toContain('maxRequestBytes: 262144');
      expect(MAX_REQUEST_BYTES).toBe(262144);
      expect(openapi).toContain('scope: POST /v1/analyses only');
      expect(SLOW_DELAY_MS).toBeGreaterThan(ANALYSIS_FALLBACK_START_MS);
      expect(LATE_DELAY_MS).toBeLessThan(ANALYSIS_REQUEST_LIFETIME_MS);
    });

    it('returns 413 for an oversized body before the success delay', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      let settled = false;
      const promise = transport
        .postAnalyze('x'.repeat(MAX_REQUEST_BYTES + 1))
        .then((response) => {
          settled = true;
          return response;
        });

      await jest.advanceTimersByTimeAsync(0);
      expect(settled).toBe(true);
      const res = await promise;
      const problem = res.body as Problem;

      expect(res.status).toBe(413);
      expect(problem.code).toBe('payload_too_large');
      expect(problem.message).toContain(String(MAX_REQUEST_BYTES));
      expect(problem.message).not.toContain('64 KiB');
      expect(transport.getRecordedRequests()[0]?.rawBody).toBe('');
      expect(transport.getRecordedRequests()[0]?.byteLength).toBe(
        MAX_REQUEST_BYTES + 1,
      );
    });

    it('returns 413 when Content-Length declares more than 262144 bytes', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const promise = transport.fetch(
        'https://analysis.ingradient.invalid/v1/analyses',
        {
          method: 'POST',
          headers: { 'content-length': String(MAX_REQUEST_BYTES + 8) },
          body: JSON.stringify(sampleAnalyzeRequest()),
        },
      );
      await jest.advanceTimersByTimeAsync(0);
      const response = await promise;
      expect(response.status).toBe(413);
    });

    it('returns 400 for invalid JSON instead of a network error', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const promise = transport.postAnalyze('{');
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      const res = await promise;
      expect(res.status).toBe(400);
      expect(res.ok).toBe(false);
      expect((res.body as Problem).code).toBe('invalid_request');
    });

    it.each(wireNegatives.filter((item) => item.schema === 'AnalyzeRequest'))(
      'rejects frozen wire negative before success: $name',
      async (negative) => {
        const transport = createMockBackendTransport({ scenario: 'fast' });
        const promise = transport.postAnalyze(JSON.stringify(negative.value));
        await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
        const res = await promise;
        expect(res.status).toBe(400);
        expect(res.ok).toBe(false);
        expect((res.body as Problem).code).toBe('invalid_request');
      },
    );
  });

  describe('rate limit is POST only', () => {
    it('returns 200 from GET /health and 429 from POST during cooldown', async () => {
      const transport = createMockBackendTransport({
        scenario: 'rate_limited',
      });
      const healthPromise = transport.getHealth();
      const postPromise = transport.postAnalyze(sampleAnalyzeRequest());
      await jest.advanceTimersByTimeAsync(50);
      const health = await healthPromise;
      const post = await postPromise;

      expect(health.status).toBe(200);
      expect(wireValidators.Health(health.body)).toBe(true);
      expect(health.headers['retry-after']).toBeUndefined();
      expect(post.status).toBe(429);
      expect(post.headers['retry-after']).toBe(
        String(RATE_LIMIT_COOLDOWN_SECONDS),
      );
      expect((post.body as Problem).code).toBe('rate_limited');
    });

    it('does not parse a POST body before the 429', async () => {
      const transport = createMockBackendTransport({
        scenario: 'rate_limited',
      });
      const promise = transport.postAnalyze('{');
      await jest.advanceTimersByTimeAsync(50);
      const res = await promise;
      expect(res.status).toBe(429);
    });
  });

  describe('AbortSignal', () => {
    it('rejects AbortError before dispatch when the signal is already aborted', async () => {
      const transport = createMockBackendTransport({ scenario: 'late' });
      const controller = new AbortController();
      controller.abort();
      let succeeded = false;
      const promise = transport
        .fetch('https://analysis.ingradient.invalid/v1/analyses', {
          method: 'POST',
          body: JSON.stringify(sampleAnalyzeRequest()),
          signal: controller.signal,
        })
        .then((response) => {
          succeeded = true;
          return response;
        });

      await expect(promise).rejects.toBeInstanceOf(DOMException);
      await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
      expect(transport.getRecordedRequests()).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(ANALYSIS_REQUEST_LIFETIME_MS);
      expect(succeeded).toBe(false);
    });

    it('rejects AbortError during the delay, clears the timer and does not succeed later', async () => {
      jest.useRealTimers();
      const clock = new ManualClock();
      const clearTimer = jest.spyOn(clock, 'clearTimeout');
      const transport = createMockBackendTransport({
        scenario: 'slow',
        clock,
      });
      const controller = new AbortController();
      const removeListener = jest.spyOn(
        controller.signal,
        'removeEventListener',
      );
      let succeeded = false;
      const promise = transport
        .fetch('https://analysis.ingradient.invalid/v1/analyses', {
          method: 'POST',
          body: JSON.stringify(sampleAnalyzeRequest()),
          signal: controller.signal,
        })
        .then((response) => {
          succeeded = true;
          return response;
        });

      await Promise.resolve();
      expect(transport.getRecordedRequests()).toHaveLength(1);
      const rejection = expect(promise).rejects.toMatchObject({
        name: 'AbortError',
      });
      controller.abort();
      await rejection;
      expect(clearTimer).toHaveBeenCalled();
      expect(removeListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
      );
      clock.advanceBy(SLOW_DELAY_MS);
      expect(succeeded).toBe(false);
    });

    it('also aborts getHealth when the signal fires during the warm-up delay', async () => {
      const transport = createMockBackendTransport({ scenario: 'fast' });
      const controller = new AbortController();
      let succeeded = false;
      const promise = transport
        .fetch('https://analysis.ingradient.invalid/health', {
          signal: controller.signal,
        })
        .then((response) => {
          succeeded = true;
          return response;
        });

      await jest.advanceTimersByTimeAsync(0);
      const rejection = expect(promise).rejects.toMatchObject({
        name: 'AbortError',
      });
      controller.abort();
      await rejection;
      await jest.advanceTimersByTimeAsync(FAST_DELAY_MS);
      expect(succeeded).toBe(false);
    });
  });
});
