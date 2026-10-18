import type { AnalyzeResponse } from '../contracts/generated/wire';
import { inputDigestOfRequestBody } from '../contracts/input-digest';
import type { ResourceCompatibility } from './resources';

/**
 * May a backend answer be shown (D70, D104, D105, HYB-01 case 4)?
 *
 * Checked when the body is applied, not when it arrived: the answer must be
 * for the exact product that was sent (inputDigest of JSON.parse of the sent
 * body), use the installed taxonomy and evidence editions, and, when graded,
 * the installed method edition and bundle hash. The scan must still be the
 * active one, before the request's monotonic deadline.
 */

export type OfferRejection =
  | 'scan_inactive'
  | 'deadline_passed'
  | 'digest_mismatch'
  | 'edition_mismatch'
  | 'method_mismatch';

export interface OfferCheck {
  sentBody: string;
  response: AnalyzeResponse;
  resources: ResourceCompatibility;
  scanActive: boolean;
  /** Monotonic clock reading now, and the stored request deadline. */
  now: number;
  deadline: number;
}

export function checkBackendAnswer(
  check: OfferCheck,
): { ok: true } | { ok: false; reason: OfferRejection } {
  if (!check.scanActive) {
    return { ok: false, reason: 'scan_inactive' };
  }
  if (check.now > check.deadline) {
    return { ok: false, reason: 'deadline_passed' };
  }
  const { response, resources } = check;
  if (response.inputDigest !== inputDigestOfRequestBody(check.sentBody)) {
    return { ok: false, reason: 'digest_mismatch' };
  }
  if (
    response.product.taxonomyVersion !== resources.taxonomyVersion ||
    response.product.evidenceVersion !== resources.evidenceVersion
  ) {
    return { ok: false, reason: 'edition_mismatch' };
  }
  if (
    response.scientific.state === 'graded' &&
    (response.scientific.method.edition !== resources.methodEdition ||
      response.scientific.method.bundleSha256 !== resources.methodBundleSha256)
  ) {
    return { ok: false, reason: 'method_mismatch' };
  }
  return { ok: true };
}
