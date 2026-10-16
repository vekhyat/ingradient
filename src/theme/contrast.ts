/**
 * WCAG 2.2 contrast ratio for opaque sRGB colours.
 * https://www.w3.org/TR/WCAG22/#dfn-contrast-ratio
 */

const HEX = /^#([0-9a-f]{6})$/i;

export function parseHex(hex: string): [number, number, number] {
  const match = HEX.exec(hex);
  if (!match || match[1] === undefined) {
    throw new TypeError(`Expected an opaque #RRGGBB colour, got "${hex}".`);
  }
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text needs 4.5:1 (D48). Control boundaries and focus need 3:1. */
export const TEXT_MIN = 4.5;
export const NON_TEXT_MIN = 3;
