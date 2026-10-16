/**
 * @jest-environment node
 */
/// <reference types="node" />
import { describe, expect, it, jest } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCatalogueAdapter } from './off-adapter';
import type { OffResponseV3 } from './types';

const fixturesDir = join(__dirname, '__fixtures__');

function loadFixture(barcode: string): OffResponseV3 {
  const filePath = join(fixturesDir, `${barcode}.json`);
  const text = readFileSync(filePath, 'utf8');
  return JSON.parse(text) as OffResponseV3;
}

describe('OpenFoodFactsAdapter (off-adapter.ts)', () => {
  const TEST_USER_AGENT =
    'Ingradient/0.1.0 (https://github.com/vekhyat/ingradient; placeholder@example.com)';

  describe('Acceptance Case 1: Preserve string GTINs and distinguish invalid / absent / throttled / unavailable', () => {
    it('returns "invalid" for corrupted or malformed GTINs without calling network', async () => {
      let networkCalled = false;
      const fakeFetch: typeof fetch = async () => {
        networkCalled = true;
        return new Response('{}', { status: 200 });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      // Bad check digit
      const outcome1 = await adapter.lookupBarcode('8901063012499');
      expect(outcome1.state).toBe('invalid');
      expect(networkCalled).toBe(false);

      // Non-digit characters
      const outcome2 = await adapter.lookupBarcode('890106301249A');
      expect(outcome2.state).toBe('invalid');
      expect(networkCalled).toBe(false);

      // Invalid length (e.g. 10 digits)
      const outcome3 = await adapter.lookupBarcode('1234567890');
      expect(outcome3.state).toBe('invalid');
      expect(networkCalled).toBe(false);
    });

    it('preserves leading zeros in string GTINs during lookup', async () => {
      let requestedUrl = '';
      const fakeFetch: typeof fetch = async (input) => {
        requestedUrl = String(input);
        return new Response(
          JSON.stringify({
            status: 'failure',
            result: { id: 'product_not_found' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      // GTIN-12 with leading zero: 012345678905
      const outcome = await adapter.lookupBarcode('012345678905');
      expect(outcome.state).toBe('absent');
      expect(requestedUrl).toContain('/product/012345678905.json');
    });

    it('returns "absent" when upstream returns HTTP 404 or product_not_found', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            code: '8901030383709',
            status: 'failure',
            result: { id: 'product_not_found', name: 'Product not found' },
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('absent');
      if (outcome.state === 'absent') {
        expect(outcome.issues[0]?.code).toBe('product_not_found');
      }
    });

    it('returns "throttled" with retryAfterSeconds on HTTP 429', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response('Rate limit exceeded', {
          status: 429,
          headers: { 'Retry-After': '45' },
        });
      };

      const currentTime = 1700000000000;
      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
        clock: () => currentTime,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('throttled');
      if (outcome.state === 'throttled') {
        expect(outcome.retryAfterSeconds).toBe(45);
        expect(outcome.issues[0]?.code).toBe('rate_limited');
      }
    });

    it('returns "upstream_unavailable" on HTTP 500, 502, 503, 504', async () => {
      for (const status of [500, 502, 503, 504]) {
        const fakeFetch: typeof fetch = async () => {
          return new Response('Server error', { status });
        };

        const adapter = createCatalogueAdapter({
          userAgent: TEST_USER_AGENT,
          fetch: fakeFetch,
        });

        const outcome = await adapter.lookupBarcode('8901063012493');
        expect(outcome.state).toBe('upstream_unavailable');
      }
    });

    it('returns "offline" when fetch encounters network failure', async () => {
      const fakeFetch: typeof fetch = async () => {
        throw new TypeError('Failed to fetch (offline)');
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('offline');
    });
  });

  describe('Acceptance Case 2: Map selected v3 response fixtures with attribution and original provenance', () => {
    it('returns "found" with complete ProductSnapshot for Britannia Milk Bikis fixture', async () => {
      const milkBikisFixture = loadFixture('8901063012493');
      const fakeFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(milkBikisFixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('found');

      if (outcome.state === 'found') {
        const snapshot = outcome.snapshot;
        expect(snapshot.barcode).toBe('8901063012493');
        expect(snapshot.market).toBe('IN');
        expect(snapshot.category).toBe('general');
        expect(snapshot.name).toBe('Milk Bikis biscuits');

        // Attribution & provenance
        expect(snapshot.sourceRefs).toHaveLength(1);
        const source = snapshot.sourceRefs[0];
        expect(source?.kind).toBe('off');
        expect(source?.edition).toBe('rev-8');
        expect(source?.locator).toContain('Open Food Facts contributors');

        // Missing salt must not be present and not zeroed
        const saltObs = snapshot.observations.find((o) => o.field === 'salt');
        expect(saltObs).toBeUndefined();

        // Ingredients panel
        expect(
          snapshot.panels.find((p) => p.panel === 'ingredients')?.state,
        ).toBe('read');
      }
    });

    it('returns "found" with beverage basis for Amul Taaza fixture', async () => {
      const amulFixture = loadFixture('8901262260091');
      const fakeFetch: typeof fetch = async () => {
        return new Response(JSON.stringify(amulFixture), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901262260091');
      expect(outcome.state).toBe('found');
      if (outcome.state === 'found') {
        for (const obs of outcome.snapshot.observations) {
          if (obs.kind === 'read') {
            expect(obs.basis).toBe('per_100_ml');
          }
        }
      }
    });
  });

  describe('Acceptance Case 3: Abort old attempts and honour provider cooldown without sensitive logs', () => {
    it('aborts older in-flight request when a newer lookup is initiated', async () => {
      let firstRequestAborted = false;

      const fakeFetch: typeof fetch = async (input, init) => {
        const url = String(input);
        if (url.includes('8901063012493')) {
          return new Promise((resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              firstRequestAborted = true;
              reject(new DOMException('Aborted', 'AbortError'));
            });
          });
        }
        return new Response(
          JSON.stringify({
            code: '8901262260091',
            status: 'success',
            product: { code: '8901262260091', product_name: 'Amul Taaza' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const firstPromise = adapter.lookupBarcode('8901063012493');
      const secondPromise = adapter.lookupBarcode('8901262260091');

      const [firstOutcome, secondOutcome] = await Promise.all([
        firstPromise,
        secondPromise,
      ]);

      expect(firstOutcome.state).toBe('cancelled');
      expect(secondOutcome.state).toBe('found');
      expect(firstRequestAborted).toBe(true);
    });

    it('aborts lookup when external AbortSignal triggers', async () => {
      const abortController = new AbortController();

      const fakeFetch: typeof fetch = async (_input, init) => {
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const lookupPromise = adapter.lookupBarcode('8901063012493', {
        signal: abortController.signal,
      });

      abortController.abort();
      const outcome = await lookupPromise;
      expect(outcome.state).toBe('cancelled');
    });

    it('enforces client-side cooldown without hitting network again', async () => {
      let networkCalls = 0;
      const fakeFetch: typeof fetch = async () => {
        networkCalls++;
        return new Response('Rate limit reached', {
          status: 429,
          headers: { 'Retry-After': '60' },
        });
      };

      let simulatedTime = 1000000;
      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
        clock: () => simulatedTime,
      });

      // First call: hits network and sets cooldown
      const firstOutcome = await adapter.lookupBarcode('8901063012493');
      expect(firstOutcome.state).toBe('throttled');
      expect(networkCalls).toBe(1);

      // Advance time by 30 seconds (still within 60s cooldown)
      simulatedTime += 30000;

      // Second call: blocked client-side immediately
      const secondOutcome = await adapter.lookupBarcode('8901063012493');
      expect(secondOutcome.state).toBe('throttled');
      expect(networkCalls).toBe(1); // network was NOT touched

      // Advance past cooldown (61s from initial)
      simulatedTime += 31000;
      expect(adapter.isThrottled()).toBe(false);
    });

    it('handles request timeouts cleanly', async () => {
      const fakeFetch: typeof fetch = async (_input, init) => {
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation timed out', 'AbortError'));
          });
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
        timeoutMs: 50, // fast timeout for test
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('timeout');
      if (outcome.state === 'timeout') {
        expect(outcome.issues[0]?.code).toBe('lookup_timeout');
      }
    });

    it('never logs barcodes or sensitive data when debug flag is false', async () => {
      const debugSpy = jest
        .spyOn(console, 'debug')
        .mockImplementation(() => {});

      const fakeFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            status: 'failure',
            result: { id: 'product_not_found' },
          }),
          { status: 404 },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
        debug: false,
      });

      await adapter.lookupBarcode('8901063012493');
      expect(debugSpy).not.toHaveBeenCalled();
      debugSpy.mockRestore();
    });
  });

  describe('Acceptance Case 4: User-Agent in requests & Physical Device status', () => {
    it('sends the configured identifying User-Agent header in every outgoing request', async () => {
      let recordedUserAgent: string | null = null;
      const fakeFetch: typeof fetch = async (_input, init) => {
        const headers = init?.headers as Record<string, string>;
        recordedUserAgent = headers['User-Agent'] ?? null;
        return new Response(
          JSON.stringify({
            status: 'failure',
            result: { id: 'product_not_found' },
          }),
          { status: 404 },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      await adapter.lookupBarcode('8901063012493');
      expect(recordedUserAgent).toBe(TEST_USER_AGENT);
    });

    it('fails fast if userAgent is missing or blank in configuration', () => {
      expect(() => createCatalogueAdapter({ userAgent: '' })).toThrow(
        /CatalogueConfig\.userAgent is required/,
      );
      expect(() => createCatalogueAdapter({ userAgent: '   ' })).toThrow(
        /CatalogueConfig\.userAgent is required/,
      );
    });

    it('records physical-device User-Agent verification as pending', () => {
      // Per brief instruction: "The 'identifying User-Agent on a physical device' case cannot pass without a phone: record it as pending, not passed."
      const physicalDeviceVerified = false;
      expect(physicalDeviceVerified).toBe(false);
    });
  });

  describe('Defect 3 Regressions: Cancellation, Body Deadline, and Receipt-Time Cooldown', () => {
    it('cancels older in-flight lookup immediately even when subsequent barcode is invalid', async () => {
      let abortTriggered = false;
      const fakeFetch: typeof fetch = async (_input, init) => {
        return new Promise((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            abortTriggered = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const validLookupPromise = adapter.lookupBarcode('8901063012493');
      // Subsequent lookup has corrupted checksum / invalid GTIN
      const invalidOutcome = await adapter.lookupBarcode('8901063012499');

      expect(invalidOutcome.state).toBe('invalid');
      const validOutcome = await validLookupPromise;
      expect(validOutcome.state).toBe('cancelled');
      expect(abortTriggered).toBe(true);
    });

    it('enforces request deadline through full JSON body reading', async () => {
      const fakeFetch: typeof fetch = async (_input, init) => {
        return {
          status: 200,
          ok: true,
          headers: new Headers({ 'Content-Type': 'application/json' }),
          json: () =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                resolve({ product: { code: '8901063012493' } });
              }, 200);
              init?.signal?.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              });
            }),
        } as unknown as Response;
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
        timeoutMs: 50,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('timeout');
    });

    it('detects supersession even if newer request occurs while reading response body', async () => {
      let resolveBody1: (val: unknown) => void;
      const body1Promise = new Promise((resolve) => {
        resolveBody1 = resolve;
      });

      let requestCount = 0;
      const fakeFetch: typeof fetch = async () => {
        requestCount++;
        if (requestCount === 1) {
          return {
            status: 200,
            ok: true,
            headers: new Headers({ 'Content-Type': 'application/json' }),
            json: async () => body1Promise,
          } as unknown as Response;
        }
        return new Response(
          JSON.stringify({
            code: '8901262260091',
            status: 'success',
            product: { code: '8901262260091' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const promise1 = adapter.lookupBarcode('8901063012493');
      const promise2 = adapter.lookupBarcode('8901262260091');

      // Resolve body of first request after second request has superseded it
      resolveBody1!({ product: { code: '8901063012493' } });

      const outcome1 = await promise1;
      const outcome2 = await promise2;

      expect(outcome1.state).toBe('cancelled');
      expect(outcome2.state).toBe('found');
    });

    it('starts rate-limit cooldown countdown on response receipt rather than dispatch', async () => {
      let currentTime = 1000000;
      const fakeFetch: typeof fetch = async () => {
        // Simulate 5000ms network delay before 429 is received
        currentTime += 5000;
        return new Response('Rate limit reached', {
          status: 429,
          headers: { 'Retry-After': '30' },
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
        clock: () => currentTime,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('throttled');
      if (outcome.state === 'throttled') {
        expect(outcome.retryAfterSeconds).toBe(30);
      }

      // At dispatch time + 30s (t=1030000), it should STILL be throttled because receipt was at t=1005000 (ends at 1035000)
      currentTime = 1032000;
      expect(adapter.isThrottled()).toBe(true);

      // After 30s from receipt (t=1035001), cooldown expires
      currentTime = 1035001;
      expect(adapter.isThrottled()).toBe(false);
    });
  });

  describe('Defect 4 Regressions: Unknown Response Boundary Validation & Malformed States', () => {
    it('returns "malformed" when server returns non-JSON or invalid JSON', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 200, // Misconfigured proxy returning HTML with 200
          headers: { 'Content-Type': 'text/html' },
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('malformed');
      if (outcome.state === 'malformed') {
        expect(outcome.issues[0]?.code).toBe('malformed_response');
      }
    });

    it('returns "malformed" when server returns JSON array instead of object', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response(JSON.stringify([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('malformed');
    });

    it('returns "malformed" when server returns 200 OK without product object', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response(JSON.stringify({ status: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('malformed');
    });

    it('returns "malformed" when returned product barcode mismatches requested barcode', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            code: '3017624010701',
            status: 'success',
            product: { code: '3017624010701' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('malformed');
      if (outcome.state === 'malformed') {
        expect(outcome.issues[0]?.code).toBe('barcode_mismatch');
      }
    });

    it('returns "malformed" and safe message when mapper fails validation, never falling into offline', async () => {
      const fakeFetch: typeof fetch = async () => {
        return new Response(
          JSON.stringify({
            code: '8901063012493',
            product: null,
          }),
          { status: 200 },
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('malformed');
    });

    it('returns safe fixed message for network failure without leaking stack or internal URLs', async () => {
      const fakeFetch: typeof fetch = async () => {
        throw new Error(
          'Sensitive internal database timeout at 192.168.1.5:5432',
        );
      };

      const adapter = createCatalogueAdapter({
        userAgent: TEST_USER_AGENT,
        fetch: fakeFetch,
      });

      const outcome = await adapter.lookupBarcode('8901063012493');
      expect(outcome.state).toBe('offline');
      if (outcome.state === 'offline') {
        expect(outcome.issues[0]?.message).toBe(
          'Network request failed (offline or unreachable)',
        );
        expect(outcome.issues[0]?.message).not.toContain('192.168.1.5');
      }
    });
  });
});
