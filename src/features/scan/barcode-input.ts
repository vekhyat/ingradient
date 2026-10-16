import { isValidGtin } from '../../adapters/catalogue/gtin';
import type { BarcodeFieldError } from '../../components/TextField';

/**
 * Checks typed barcode digits before any lookup, so an invalid code never
 * reaches the network. Returns the cleaned code or the error to show.
 */
export function checkTypedBarcode(
  raw: string,
): { ok: true; code: string } | { ok: false; error: BarcodeFieldError } {
  if (raw.length === 0) {
    return { ok: false, error: 'empty' };
  }
  if (!/^\d+$/.test(raw)) {
    return { ok: false, error: 'invalid_chars' };
  }
  if (raw.length > 14) {
    return { ok: false, error: 'too_long' };
  }
  if (![8, 12, 13, 14].includes(raw.length)) {
    return { ok: false, error: 'invalid_length' };
  }
  if (!isValidGtin(raw)) {
    return { ok: false, error: 'invalid_checksum' };
  }
  return { ok: true, code: raw };
}
