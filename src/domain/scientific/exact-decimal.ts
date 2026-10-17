import { formatDecimal, type Decimal } from '../nutrition/decimal';

/**
 * Exact arithmetic for threshold comparisons.
 *
 * Points change exactly at a threshold, and binary floating point misplaces
 * derived values: 0.7 / 7 * 100 evaluates to 9.999999999999998, which would
 * score a 10 % saturates ratio as below 10 %. Every comparison here works on
 * integers scaled by a power of ten (the `Decimal` shape PAR-02 already uses).
 */

const NUMBER_TEXT = /^(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/;

/**
 * The exact decimal written by `String(value)`, which is the shortest text
 * that reads back as the same double. A JSON literal such as 0.6 therefore
 * stays 0.6 rather than 0.59999999999999997779.
 * Returns null for negative, infinite or NaN values.
 */
export function decimalFromNumber(value: number): Decimal | null {
  if (!Number.isFinite(value) || value < 0) {
    return null;
  }
  const match = NUMBER_TEXT.exec(String(value));
  if (match === null) {
    return null;
  }
  const intPart = match[1] ?? '0';
  const fracPart = match[2] ?? '';
  const exponent = Number(match[3] ?? '0');
  let significand = BigInt(`${intPart}${fracPart}`);
  let scale = fracPart.length - exponent;
  if (scale < 0) {
    significand *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return normalize({ significand, scale });
}

export function compareDecimals(left: Decimal, right: Decimal): -1 | 0 | 1 {
  const scale = Math.max(left.scale, right.scale);
  const a = left.significand * 10n ** BigInt(scale - left.scale);
  const b = right.significand * 10n ** BigInt(scale - right.scale);
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

export function multiplyDecimals(left: Decimal, right: Decimal): Decimal {
  return normalize({
    significand: left.significand * right.significand,
    scale: left.scale + right.scale,
  });
}

export function decimalText(value: Decimal): string {
  return formatDecimal(value);
}

/**
 * numerator / denominator rounded half up to `places` decimals, for display
 * only. Points are never computed from this text.
 */
export function divideForDisplay(
  numerator: Decimal,
  denominator: Decimal,
  places: number,
): { text: string; exact: boolean } {
  if (denominator.significand === 0n) {
    throw new RangeError('divideForDisplay: denominator is zero');
  }
  const n = numerator.significand * 10n ** BigInt(denominator.scale + places);
  const d = denominator.significand * 10n ** BigInt(numerator.scale);
  const quotient = n / d;
  const remainder = n % d;
  const rounded = remainder * 2n >= d ? quotient + 1n : quotient;
  return {
    text: formatDecimal(normalize({ significand: rounded, scale: places })),
    exact: remainder === 0n,
  };
}

function normalize(value: Decimal): Decimal {
  let { significand, scale } = value;
  while (scale > 0 && significand % 10n === 0n) {
    significand /= 10n;
    scale -= 1;
  }
  return { significand, scale };
}
