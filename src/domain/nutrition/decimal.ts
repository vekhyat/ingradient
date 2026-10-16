/**
 * Exact decimal for label amounts.
 *
 * A nutrition cell is a short decimal, not a float expression. Keeping the
 * digits avoids turning 280 mg into 0.27999999999999997 g.
 * The value is significand / 10^scale.
 */
export interface Decimal {
  significand: bigint;
  scale: number;
}

export function decimalFromParts(intPart: string, fracPart: string): Decimal {
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, '');
  const significand = BigInt(digits.length === 0 ? '0' : digits);
  return normalize({ significand, scale: fracPart.length });
}

export function addScale(value: Decimal, places: number): Decimal {
  return normalize({
    significand: value.significand,
    scale: value.scale + places,
  });
}

/** Multiply by an integer, then divide, extending the scale until the division is exact. */
export function multiplyRational(
  value: Decimal,
  numerator: bigint,
  denominator: bigint,
): Decimal {
  let significand = value.significand * numerator;
  let scale = value.scale;
  while (significand % denominator !== 0n && scale < 12) {
    significand *= 10n;
    scale += 1;
  }
  if (significand % denominator === 0n) {
    significand /= denominator;
  } else {
    const quotient = significand / denominator;
    const remainder = significand % denominator;
    significand = remainder * 2n >= denominator ? quotient + 1n : quotient;
  }
  return normalize({ significand, scale });
}

export function decimalsEqual(left: Decimal, right: Decimal): boolean {
  const scale = Math.max(left.scale, right.scale);
  const leftScaled = left.significand * 10n ** BigInt(scale - left.scale);
  const rightScaled = right.significand * 10n ** BigInt(scale - right.scale);
  return leftScaled === rightScaled;
}

export function formatDecimal(value: Decimal): string {
  const digits = value.significand.toString();
  if (value.scale === 0) {
    return digits;
  }
  const padded = digits.padStart(value.scale + 1, '0');
  const cut = padded.length - value.scale;
  const text = `${padded.slice(0, cut)}.${padded.slice(cut)}`;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

export function decimalToNumber(value: Decimal): number {
  return Number(formatDecimal(value));
}

function normalize(value: Decimal): Decimal {
  let significand = value.significand;
  let scale = value.scale;
  while (scale > 0 && significand % 10n === 0n) {
    significand /= 10n;
    scale -= 1;
  }
  return { significand, scale };
}
