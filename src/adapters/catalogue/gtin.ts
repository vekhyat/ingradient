/**
 * GTIN (Global Trade Item Number) check-digit validation.
 *
 * Supports GTIN-8, GTIN-12 (UPC-A), GTIN-13 (EAN-13), and GTIN-14.
 *
 * Algorithm per GS1 General Specifications (Section 7.9.1):
 * - Barcode must consist of digits only.
 * - Leading zeros are preserved as strings.
 * - From right to left (excluding the check digit):
 *   odd positions have weight 3, even positions have weight 1.
 * - Check digit = (10 - (sum % 10)) % 10.
 *
 * @see https://www.gs1.org/services/how-calculate-check-digit-manually
 */

const VALID_GTIN_LENGTHS = new Set([8, 12, 13, 14]);

/**
 * Calculates the GS1 modulo-10 check digit for a string of numeric digits.
 *
 * @param digitsWithoutCheckDigit - Digits preceding the check digit (7, 11, 12, or 13 digits)
 * @returns Modulo-10 check digit (0-9)
 */
export function calculateGtinCheckDigit(
  digitsWithoutCheckDigit: string,
): number {
  if (!/^\d+$/.test(digitsWithoutCheckDigit)) {
    throw new Error('Barcode must contain digits only');
  }

  let sum = 0;
  const len = digitsWithoutCheckDigit.length;

  for (let i = 0; i < len; i++) {
    const char = digitsWithoutCheckDigit.charAt(len - 1 - i);
    const digit = Number.parseInt(char, 10);
    // Position 1 (distance 1 from right) has weight 3, position 2 has weight 1, etc.
    const weight = i % 2 === 0 ? 3 : 1;
    sum += digit * weight;
  }

  return (10 - (sum % 10)) % 10;
}

/**
 * Validates whether a barcode string is a valid GTIN-8, GTIN-12, GTIN-13, or GTIN-14.
 *
 * Preserves the string format and ensures leading zeros are not discarded.
 *
 * @param barcode - Candidate barcode string
 * @returns true if barcode is non-empty, correct length, numeric, and has matching check digit
 */
export function isValidGtin(barcode: unknown): barcode is string {
  if (typeof barcode !== 'string') {
    return false;
  }

  if (!VALID_GTIN_LENGTHS.has(barcode.length)) {
    return false;
  }

  if (!/^\d+$/.test(barcode)) {
    return false;
  }

  const payload = barcode.slice(0, -1);
  const expectedCheckDigit = calculateGtinCheckDigit(payload);
  const actualCheckDigit = Number.parseInt(
    barcode.charAt(barcode.length - 1),
    10,
  );

  return expectedCheckDigit === actualCheckDigit;
}

/**
 * Checks whether a returned barcode matches the requested barcode.
 * Supports exact match and GS1 14-digit zero-padded canonical matching.
 *
 * @param requested - The barcode requested by the client
 * @param returned - The barcode returned in the upstream payload
 */
export function areMatchingGtins(requested: string, returned: string): boolean {
  if (requested === returned) {
    return true;
  }
  if (!/^\d+$/.test(requested) || !/^\d+$/.test(returned)) {
    return false;
  }
  return requested.padStart(14, '0') === returned.padStart(14, '0');
}
