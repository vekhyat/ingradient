/**
 * Named client timers from contracts/openapi-hybrid.yaml
 * (`x-draft-client-policy`, `x-draft-operating-limits`). The drift test reads
 * the frozen file, so a change there fails until this copy is updated.
 */

/** D69: start the phone analysis this long after the request is sent. */
export const ANALYSIS_FALLBACK_START_MS = 2000;

/** D104: the request stays open this long from the same send. */
export const ANALYSIS_REQUEST_LIFETIME_MS = 90000;

/** Warm-up ping on Scan entry at most this often; no repeating timer. */
export const WARMUP_MIN_INTERVAL_MS = 10 * 60 * 1000;

/** Bodies over this size are not sent (the server answers 413). */
export const MAX_REQUEST_BYTES = 262144;

/** The wire contract this client speaks. */
export const WIRE_CONTRACT_VERSION = '0.3.0-draft';
