import { CooldownManager } from './cooldown';
import { areMatchingGtins, isValidGtin } from './gtin';
import { mapOffProductToSnapshot } from './off-mapper';
import type {
  CatalogueConfig,
  LookupOptions,
  LookupOutcome,
  OffProductV3,
  ProductSnapshot,
} from './types';

export const DEFAULT_OFF_BASE_URL = 'https://world.openfoodfacts.org';
export const DEFAULT_TIMEOUT_MS = 8000;
export const DEFAULT_COOLDOWN_SECONDS = 60;

export const DEFAULT_OFF_FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'nutrition_data_per',
  'ingredients_text',
  'ingredients_text_en',
  'ingredients',
  'nutriments',
  'countries_tags',
  'categories_tags',
  'rev',
  'last_modified_t',
] as const;

/**
 * Direct Open Food Facts product adapter (Task DAT-01).
 *
 * Implements GTIN checksum validation, v3 REST queries with field filtering,
 * AbortController-driven cancellation, client-side rate limit cooldown,
 * privacy-preserving logging, strict boundary validation, and mapping to local contracts.
 */
export class OpenFoodFactsAdapter {
  private readonly config: CatalogueConfig;
  private readonly cooldown: CooldownManager;
  private activeAbortController: AbortController | null = null;
  private currentLookupSeq = 0;

  public constructor(config: CatalogueConfig) {
    if (!config.userAgent || config.userAgent.trim() === '') {
      throw new Error(
        'CatalogueConfig.userAgent is required by Open Food Facts terms of service',
      );
    }
    this.config = config;
    this.cooldown = new CooldownManager();
  }

  /**
   * Returns whether the adapter is currently within an active rate-limit cooldown.
   */
  public isThrottled(): boolean {
    const now = this.config.clock ? this.config.clock() : Date.now();
    return this.cooldown.isThrottled(now);
  }

  /**
   * Returns the remaining cooldown duration in seconds.
   */
  public getRemainingCooldownSeconds(): number {
    const now = this.config.clock ? this.config.clock() : Date.now();
    return this.cooldown.getRemainingSeconds(now);
  }

  /**
   * Resets cooldown state (primarily for tests).
   */
  public resetCooldown(): void {
    this.cooldown.reset();
  }

  /**
   * Manually aborts any in-flight lookup request.
   */
  public abortCurrent(): void {
    if (
      this.activeAbortController &&
      !this.activeAbortController.signal.aborted
    ) {
      this.activeAbortController.abort();
      this.activeAbortController = null;
    }
  }

  /**
   * Looks up a product barcode in Open Food Facts API v3.
   *
   * @param barcode - Candidate barcode string
   * @param options - Per-lookup options including optional external AbortSignal
   * @returns LookupOutcome containing either the found ProductSnapshot or named outcome
   */
  public async lookupBarcode(
    barcode: string,
    options?: LookupOptions,
  ): Promise<LookupOutcome> {
    // 1. Immediately abort any prior in-flight lookup regardless of new barcode validity.
    // This guarantees that a prior valid lookup is cancelled even when a subsequent barcode is invalid.
    this.abortCurrent();

    const now = this.config.clock ? this.config.clock() : Date.now();

    // 2. Validate GTIN before touching the network.
    // Preserves string representation and leading zeros.
    if (!isValidGtin(barcode)) {
      return {
        state: 'invalid',
        issues: [
          {
            code: 'invalid_gtin',
            stage: 'lookup',
            field: 'barcode',
            message: 'Barcode failed GTIN checksum or length validation',
            action: 'edit',
          },
        ],
      };
    }

    // 3. Client-side rate-limit cooldown check.
    if (this.cooldown.isThrottled(now)) {
      const remainingSeconds = this.cooldown.getRemainingSeconds(now);
      return {
        state: 'throttled',
        retryAfterSeconds: remainingSeconds,
        issues: [
          {
            code: 'rate_limited',
            stage: 'lookup',
            message:
              'Client in rate-limit cooldown; request skipped to avoid IP ban',
            action: 'retry',
          },
        ],
      };
    }

    const lookupSeq = ++this.currentLookupSeq;
    const controller = new AbortController();
    this.activeAbortController = controller;

    // Link caller's external AbortSignal if provided
    let cleanupExternalSignal: (() => void) | undefined;
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
        return {
          state: 'cancelled',
          issues: [
            {
              code: 'lookup_cancelled',
              stage: 'lookup',
              message: 'Lookup was cancelled before network dispatch',
              action: 'none',
            },
          ],
        };
      }
      const onExternalAbort = (): void => {
        controller.abort();
      };
      options.signal.addEventListener('abort', onExternalAbort, { once: true });
      cleanupExternalSignal = (): void => {
        options.signal?.removeEventListener('abort', onExternalAbort);
      };
    }

    // Dev-only logging (barcodes only logged behind explicit dev flag)
    if (this.config.debug) {
      console.debug(
        `[CatalogueAdapter] Dispatching lookup for barcode: ${barcode}`,
      );
    }

    const baseUrl = (this.config.baseUrl ?? DEFAULT_OFF_BASE_URL).replace(
      /\/+$/,
      '',
    );
    const fields = this.config.fields ?? DEFAULT_OFF_FIELDS;
    const url = `${baseUrl}/api/v3/product/${barcode}.json?fields=${fields.join(',')}`;

    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const fetchFn = this.config.fetch ?? globalThis.fetch;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let didTimeout = false;

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          didTimeout = true;
          controller.abort();
          reject(new Error('REQUEST_TIMEOUT'));
        }, timeoutMs);
        if (
          typeof timeoutId === 'object' &&
          typeof (timeoutId as { unref?: () => void }).unref === 'function'
        ) {
          (timeoutId as { unref: () => void }).unref();
        }
      });

      const fetchPromise = fetchFn(url, {
        method: 'GET',
        headers: {
          'User-Agent': this.config.userAgent,
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      const response = await Promise.race([fetchPromise, timeoutPromise]);

      // If superseded by a newer lookup or cancelled while fetching headers
      if (lookupSeq !== this.currentLookupSeq || controller.signal.aborted) {
        return {
          state: 'cancelled',
          issues: [
            {
              code: 'lookup_cancelled',
              stage: 'lookup',
              message: 'Lookup was cancelled or superseded by a newer request',
              action: 'none',
            },
          ],
        };
      }

      // Capture receipt time for accurate cooldown calculation
      const responseReceiptTime = this.config.clock
        ? this.config.clock()
        : Date.now();

      // Handle HTTP 429 Too Many Requests
      // Cooldown begins at response receipt time, preventing premature cooldown expiry on slow connections.
      if (response.status === 429) {
        const retryAfterHeader = response.headers.get('retry-after');
        const defaultCooldown =
          this.config.defaultCooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS;
        const cooldownSeconds = CooldownManager.parseRetryAfter(
          retryAfterHeader,
          defaultCooldown,
          responseReceiptTime,
        );

        this.cooldown.setCooldown(cooldownSeconds, responseReceiptTime);

        return {
          state: 'throttled',
          retryAfterSeconds: cooldownSeconds,
          issues: [
            {
              code: 'rate_limited',
              stage: 'lookup',
              message: 'Upstream Open Food Facts rate limit reached (HTTP 429)',
              action: 'retry',
            },
          ],
        };
      }

      // Handle HTTP 404 Not Found
      if (response.status === 404) {
        return {
          state: 'absent',
          issues: [
            {
              code: 'product_not_found',
              stage: 'lookup',
              field: 'barcode',
              message: 'Product not found on Open Food Facts',
              action: 'retake',
            },
          ],
        };
      }

      // Handle HTTP 5xx Server Errors
      if (response.status >= 500 && response.status < 600) {
        if (response.status === 503) {
          const retryAfterHeader = response.headers.get('retry-after');
          if (retryAfterHeader) {
            const cooldownSeconds = CooldownManager.parseRetryAfter(
              retryAfterHeader,
              this.config.defaultCooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS,
              responseReceiptTime,
            );
            this.cooldown.setCooldown(cooldownSeconds, responseReceiptTime);
          }
        }

        return {
          state: 'upstream_unavailable',
          issues: [
            {
              code: 'upstream_unavailable',
              stage: 'lookup',
              message: `Open Food Facts server error (HTTP ${response.status})`,
              action: 'retry',
            },
          ],
        };
      }

      // Handle other non-200 responses
      if (!response.ok) {
        return {
          state: 'upstream_unavailable',
          issues: [
            {
              code: 'unexpected_http_status',
              stage: 'lookup',
              message: `Unexpected HTTP status from Open Food Facts (${response.status})`,
              action: 'retry',
            },
          ],
        };
      }

      // Parse JSON body with deadline extending through full body retrieval
      let rawJson: unknown;
      try {
        const jsonPromise = response.json();
        rawJson = await Promise.race([jsonPromise, timeoutPromise]);
      } catch (jsonErr) {
        if (controller.signal.aborted || didTimeout) {
          throw jsonErr;
        }
        return {
          state: 'malformed',
          issues: [
            {
              code: 'malformed_response',
              stage: 'lookup',
              message: 'Failed to parse response body as JSON',
              action: 'retry',
            },
          ],
        };
      }

      // Recheck cancellation and supersession after reading response body
      if (lookupSeq !== this.currentLookupSeq || controller.signal.aborted) {
        return {
          state: 'cancelled',
          issues: [
            {
              code: 'lookup_cancelled',
              stage: 'lookup',
              message: 'Lookup was cancelled or superseded by a newer request',
              action: 'none',
            },
          ],
        };
      }

      // Boundary validation: verify response body is a non-null object
      if (
        typeof rawJson !== 'object' ||
        rawJson === null ||
        Array.isArray(rawJson)
      ) {
        return {
          state: 'malformed',
          issues: [
            {
              code: 'malformed_response',
              stage: 'lookup',
              message: 'Server response is not a valid JSON object',
              action: 'retry',
            },
          ],
        };
      }

      const jsonRecord = rawJson as Record<string, unknown>;

      // Check if product is marked absent in v3 response body
      const isAbsent =
        jsonRecord.status === 'failure' ||
        (jsonRecord.result &&
          typeof jsonRecord.result === 'object' &&
          (jsonRecord.result as Record<string, unknown>).id ===
            'product_not_found') ||
        jsonRecord.status_verbose === 'product not found';

      if (isAbsent) {
        return {
          state: 'absent',
          issues: [
            {
              code: 'product_not_found',
              stage: 'lookup',
              field: 'barcode',
              message: 'Product not found on Open Food Facts',
              action: 'retake',
            },
          ],
        };
      }

      // Validate presence of product object
      if (
        !jsonRecord.product ||
        typeof jsonRecord.product !== 'object' ||
        Array.isArray(jsonRecord.product)
      ) {
        return {
          state: 'malformed',
          issues: [
            {
              code: 'malformed_response',
              stage: 'lookup',
              message: 'Response payload is missing a valid product object',
              action: 'retry',
            },
          ],
        };
      }

      const productObj = jsonRecord.product as Record<string, unknown>;

      // Verify returned barcode matches requested GTIN (supporting exact and 14-digit canonical normalization)
      const returnedCode = productObj.code;
      const envelopeCode = jsonRecord.code;
      if (
        typeof returnedCode !== 'string' ||
        !areMatchingGtins(barcode, returnedCode) ||
        (envelopeCode !== undefined &&
          (typeof envelopeCode !== 'string' ||
            !areMatchingGtins(barcode, envelopeCode)))
      ) {
        return {
          state: 'malformed',
          issues: [
            {
              code: 'barcode_mismatch',
              stage: 'lookup',
              field: 'barcode',
              message: 'Response barcode does not match requested barcode',
              action: 'retry',
            },
          ],
        };
      }

      // Map to ProductSnapshot with boundary validation
      const capturedAt = new Date(now).toISOString();
      let snapshot: ProductSnapshot;
      try {
        snapshot = mapOffProductToSnapshot(
          barcode,
          productObj as OffProductV3,
          {
            taxonomyVersion: this.config.taxonomyVersion,
            evidenceVersion: this.config.evidenceVersion,
            capturedAt,
          },
        );
      } catch {
        return {
          state: 'malformed',
          issues: [
            {
              code: 'malformed_product_data',
              stage: 'lookup',
              message: 'Product data structure failed contract validation',
              action: 'retry',
            },
          ],
        };
      }

      return {
        state: 'found',
        snapshot,
      };
    } catch (err: unknown) {
      if (didTimeout) {
        return {
          state: 'timeout',
          issues: [
            {
              code: 'lookup_timeout',
              stage: 'lookup',
              message: `Open Food Facts request timed out after ${timeoutMs}ms`,
              action: 'retry',
            },
          ],
        };
      }

      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError') ||
        controller.signal.aborted;

      if (isAbort) {
        return {
          state: 'cancelled',
          issues: [
            {
              code: 'lookup_cancelled',
              stage: 'lookup',
              message: 'Lookup request was cancelled or aborted',
              action: 'none',
            },
          ],
        };
      }

      // Network unreachable or offline - emit fixed diagnostic message without exposing internal details
      return {
        state: 'offline',
        issues: [
          {
            code: 'network_offline',
            stage: 'lookup',
            message: 'Network request failed (offline or unreachable)',
            action: 'retry',
          },
        ],
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      if (cleanupExternalSignal) {
        cleanupExternalSignal();
      }
    }
  }
}

/**
 * Factory helper for creating an OpenFoodFactsAdapter instance.
 */
export function createCatalogueAdapter(
  config: CatalogueConfig,
): OpenFoodFactsAdapter {
  return new OpenFoodFactsAdapter(config);
}
