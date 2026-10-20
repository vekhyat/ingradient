/**
 * @jest-environment node
 */
/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import {
  areMatchingGtins,
  calculateGtinCheckDigit,
  isValidGtin,
  normalizeScannedGtin,
} from './gtin';

describe('scanner symbology normalization', () => {
  it.each([
    ['04252614', '042100005264'],
    ['01234505', '012000003455'],
    ['01234514', '012100003454'],
    ['01234523', '012200003453'],
    ['01234531', '012300000451'],
    ['01234543', '012340000053'],
    ['01234558', '012345000058'],
    ['01234596', '012345000096'],
    ['11234555', '112345000055'],
  ])('expands UPC-E %s into UPC-A %s', (compressed, expanded) => {
    expect(normalizeScannedGtin(compressed, 'upc_e')).toBe(expanded);
  });

  it('expands UPC-E even when the compressed digits also pass the GTIN-8 checksum', () => {
    expect(isValidGtin('01234558')).toBe(true);
    expect(normalizeScannedGtin('01234558', 'upc_e')).toBe('012345000058');
    expect(normalizeScannedGtin('01234558', 'ean8')).toBe('01234558');
  });

  it.each(['04252615', '24252614', '425261', '04252x14', ''])(
    'rejects malformed UPC-E %s',
    (code) => {
      expect(normalizeScannedGtin(code, 'upc_e')).toBeNull();
    },
  );

  it('preserves EAN-8 and other GTIN formats', () => {
    expect(normalizeScannedGtin('96385074', 'ean8')).toBe('96385074');
    expect(normalizeScannedGtin(' 3017624010701 ', 'ean13')).toBe(
      '3017624010701',
    );
    expect(normalizeScannedGtin('012345678905', 'upc_a')).toBe('012345678905');
  });
});

describe('GTIN Check Digit and Validation (gtin.ts)', () => {
  describe('calculateGtinCheckDigit', () => {
    it('calculates expected check digit for 7-digit payload (GTIN-8)', () => {
      // 9638507 -> check digit 4 -> 96385074
      expect(calculateGtinCheckDigit('9638507')).toBe(4);
    });

    it('calculates expected check digit for 11-digit payload (GTIN-12 / UPC-A)', () => {
      // 01234567890 -> check digit 5 -> 012345678905
      expect(calculateGtinCheckDigit('01234567890')).toBe(5);
    });

    it('calculates expected check digit for 12-digit payload (GTIN-13 / EAN-13)', () => {
      // Nutella: 301762401070 -> check digit 1 -> 3017624010701
      expect(calculateGtinCheckDigit('301762401070')).toBe(1);
      // Britannia Milk Bikis: 890106301249 -> check digit 3 -> 8901063012493
      expect(calculateGtinCheckDigit('890106301249')).toBe(3);
      // Amul Taaza: 890126226009 -> check digit 1 -> 8901262260091
      expect(calculateGtinCheckDigit('890126226009')).toBe(1);
    });

    it('calculates expected check digit for 13-digit payload (GTIN-14)', () => {
      // 1001234567890 -> check digit 2 -> 10012345678902
      expect(calculateGtinCheckDigit('1001234567890')).toBe(2);
    });

    it('throws when payload contains non-digit characters', () => {
      expect(() => calculateGtinCheckDigit('12345A7')).toThrow(
        'Barcode must contain digits only',
      );
    });
  });

  describe('isValidGtin', () => {
    it('accepts valid GTIN-8 barcodes', () => {
      expect(isValidGtin('96385074')).toBe(true);
      expect(isValidGtin('00000000')).toBe(true); // check digit for 7 zeros is 0
    });

    it('accepts valid GTIN-12 barcodes with leading zeros preserved', () => {
      expect(isValidGtin('012345678905')).toBe(true);
      expect(isValidGtin('000000000000')).toBe(true);
    });

    it('accepts valid GTIN-13 barcodes from real Indian and European foods', () => {
      expect(isValidGtin('3017624010701')).toBe(true); // Nutella
      expect(isValidGtin('8901063012493')).toBe(true); // Britannia Milk Bikis
      expect(isValidGtin('8901262260091')).toBe(true); // Amul Milk
      expect(isValidGtin('8904355407762')).toBe(true); // Apollo Dates
      expect(isValidGtin('8901058005578')).toBe(true); // Maggi
    });

    it('accepts valid GTIN-14 barcodes', () => {
      expect(isValidGtin('10012345678902')).toBe(true);
    });

    it('rejects barcode if check digit is corrupted', () => {
      // 3017624010701 -> change last digit to 2
      expect(isValidGtin('3017624010702')).toBe(false);
      // 8901063012493 -> change last digit to 0
      expect(isValidGtin('8901063012490')).toBe(false);
    });

    it('rejects barcodes with invalid lengths', () => {
      expect(isValidGtin('')).toBe(false);
      expect(isValidGtin('1234567')).toBe(false); // length 7
      expect(isValidGtin('123456789')).toBe(false); // length 9
      expect(isValidGtin('12345678901')).toBe(false); // length 11
      expect(isValidGtin('123456789012345')).toBe(false); // length 15
    });

    it('rejects barcodes with non-digit characters', () => {
      expect(isValidGtin('301762401070X')).toBe(false);
      expect(isValidGtin('3017 24010701')).toBe(false);
      expect(isValidGtin('3017624-10701')).toBe(false);
      expect(isValidGtin('abcdefghijklm')).toBe(false);
    });

    it('rejects non-string inputs safely', () => {
      expect(isValidGtin(null)).toBe(false);
      expect(isValidGtin(undefined)).toBe(false);
      expect(isValidGtin(3017624010701)).toBe(false);
      expect(isValidGtin({})).toBe(false);
      expect(isValidGtin([])).toBe(false);
    });
  });

  describe('areMatchingGtins', () => {
    it('matches identical barcodes exactly', () => {
      expect(areMatchingGtins('8901063012493', '8901063012493')).toBe(true);
      expect(areMatchingGtins('012345678905', '012345678905')).toBe(true);
    });

    it('matches zero-padded GS1 canonical equivalents', () => {
      // GTIN-12 zero-padded to GTIN-14
      expect(areMatchingGtins('012345678905', '00012345678905')).toBe(true);
      // GTIN-13 zero-padded to GTIN-14
      expect(areMatchingGtins('8901063012493', '08901063012493')).toBe(true);
    });

    it('rejects different barcodes', () => {
      expect(areMatchingGtins('8901063012493', '3017624010701')).toBe(false);
      expect(areMatchingGtins('8901063012493', '8901063012490')).toBe(false);
    });

    it('rejects invalid or non-numeric barcode strings', () => {
      expect(areMatchingGtins('8901063012493', '')).toBe(false);
      expect(areMatchingGtins('', '')).toBe(true); // identical
      expect(areMatchingGtins('8901063012493', 'invalid')).toBe(false);
    });
  });
});
