import type { AdditiveScheme } from './types';

/**
 * Additive tokens on a label.
 *
 * A bare 3–4 digit number counts only inside an additive class.
 * A year (1900–2099), a weight or volume, a percentage, a batch or an FSSAI
 * licence number never counts. A roman parenthesis is kept verbatim:
 * `503(ii)` is a different identity from `503(i)` and from `503`.
 *
 * Numbering: Codex CAC/GL 36-1989 (INS) and the E-number list used on
 * FSSAI and EU labels.
 * https://www.fao.org/fao-who-codexalimentarius/codex-texts/guidelines/en/
 */

export interface AdditiveHit {
  code: string;
  suffix: string | null;
  scheme: AdditiveScheme;
  normStart: number;
  normEnd: number;
}

const BATCH_CONTEXT =
  /\b(batch|lot|fssai|licence|license|lic\.?\s*no|mfg|mfd|pkd|mrp|expiry|best\s+before|use\s+by)\b/i;

const UNIT_AFTER =
  /^\s*(?:kilograms?|millilitres?|milliliters?|grams?|litres?|liters?|kgs?|gms?|mg|mcg|µg|μg|ug|mls?|ltrs?|lbs?|oz|cl|dl|kg|gm|g|l)\b/i;

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function boundaryBefore(text: string, index: number): boolean {
  if (index <= 0) {
    return true;
  }
  const prev = text.charAt(index - 1);
  return !isLetter(prev) && !isDigit(prev);
}

function readDigits(
  text: string,
  index: number,
): { digits: string; next: number } | null {
  if (!isDigit(text.charAt(index))) {
    return null;
  }
  let end = index;
  while (isDigit(text.charAt(end))) {
    end += 1;
  }
  const digits = text.slice(index, end);
  if (digits.length < 3 || digits.length > 4) {
    return null;
  }
  return { digits, next: end };
}

/** INS letter suffix is a–f. `g` and `m` are grams and millilitres, not a code. */
function readLetterSuffix(
  text: string,
  index: number,
): { letter: string; next: number } | null {
  const ch = text.charAt(index);
  if (!/[a-fA-F]/.test(ch)) {
    return null;
  }
  const after = text.charAt(index + 1);
  if (isLetter(after)) {
    return null;
  }
  return { letter: ch, next: index + 1 };
}

function isScannerSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
}

/**
 * `(ii)` is a roman identity. `(a)` is an INS letter when the parenthesis
 * holds one letter a–f. Spaces before the parenthesis are OCR gaps, not
 * part of the code.
 */
function readRomanParen(
  text: string,
  index: number,
): { suffix: string; next: number } | null {
  let cursor = index;
  while (isScannerSpace(text.charAt(cursor))) {
    cursor += 1;
  }
  if (text.charAt(cursor) !== '(') {
    return null;
  }
  const open = cursor;
  cursor += 1;
  const letter = text.charAt(cursor);
  if (/[a-fA-F]/.test(letter) && text.charAt(cursor + 1) === ')') {
    return { suffix: text.slice(open, cursor + 2), next: cursor + 2 };
  }
  const romanStart = cursor;
  while (/[ivxlcdmIVXLCDM]/.test(text.charAt(cursor))) {
    cursor += 1;
  }
  if (cursor === romanStart || text.charAt(cursor) !== ')') {
    return null;
  }
  return { suffix: text.slice(open, cursor + 1), next: cursor + 1 };
}

function gluedToLongerNumber(text: string, index: number): boolean {
  const prev = text.charAt(index - 1);
  if ((prev === '.' || prev === ',') && isDigit(text.charAt(index - 2))) {
    return true;
  }
  return false;
}

interface RawHit {
  scheme: AdditiveScheme;
  digits: string;
  letter: string | null;
  suffix: string | null;
  normStart: number;
  normEnd: number;
  explicit: boolean;
}

function finish(
  scheme: AdditiveScheme,
  explicit: boolean,
  start: number,
  digits: { digits: string; next: number },
  letter: { letter: string; next: number } | null,
  roman: { suffix: string; next: number } | null,
): RawHit {
  const afterLetter = letter ? letter.next : digits.next;
  const end = roman ? roman.next : afterLetter;
  return {
    scheme,
    explicit,
    digits: digits.digits,
    letter: letter ? letter.letter : null,
    suffix: roman ? roman.suffix : null,
    normStart: start,
    normEnd: end,
  };
}

function readIns(text: string, index: number): RawHit | null {
  if (!boundaryBefore(text, index)) {
    return null;
  }
  const prefix = /^(I\.?\s*N\.?\s*S\.?)[\s.\-]*/i.exec(
    text.slice(index, index + 16),
  );
  if (!prefix?.[0]) {
    return null;
  }
  const digits = readDigits(text, index + prefix[0].length);
  if (!digits) {
    return null;
  }
  const letter = readLetterSuffix(text, digits.next);
  const roman = readRomanParen(text, letter ? letter.next : digits.next);
  return finish('ins', true, index, digits, letter, roman);
}

function readE(text: string, index: number): RawHit | null {
  if (
    (text.charAt(index) !== 'E' && text.charAt(index) !== 'e') ||
    !boundaryBefore(text, index)
  ) {
    return null;
  }
  let cursor = index + 1;
  while (/[\s.\-]/.test(text.charAt(cursor))) {
    cursor += 1;
  }
  const digits = readDigits(text, cursor);
  if (!digits) {
    return null;
  }
  const letter = readLetterSuffix(text, digits.next);
  const roman = readRomanParen(text, letter ? letter.next : digits.next);
  return finish('e_number', true, index, digits, letter, roman);
}

function readPlain(text: string, index: number): RawHit | null {
  if (
    !isDigit(text.charAt(index)) ||
    isDigit(text.charAt(index - 1)) ||
    gluedToLongerNumber(text, index)
  ) {
    return null;
  }
  const digits = readDigits(text, index);
  if (!digits) {
    return null;
  }
  const letter = readLetterSuffix(text, digits.next);
  const roman = readRomanParen(text, letter ? letter.next : digits.next);
  const scheme: AdditiveScheme =
    letter || roman ? 'printed_code' : 'class_context';
  return finish(scheme, false, index, digits, letter, roman);
}

function isYear(
  digits: string,
  letter: string | null,
  suffix: string | null,
): boolean {
  if (letter || suffix) {
    return false;
  }
  const value = Number(digits);
  return value >= 1900 && value <= 2099;
}

function rejected(text: string, hit: RawHit, classContext: boolean): boolean {
  const bare = !hit.explicit && hit.letter === null && hit.suffix === null;
  if (isYear(hit.digits, hit.letter, hit.suffix)) {
    return true;
  }
  const after = text.slice(hit.normEnd);
  if (/^\s*%/.test(after) || UNIT_AFTER.test(after) || /^[.,]\d/.test(after)) {
    return true;
  }
  if (bare && !classContext) {
    return true;
  }
  if (bare) {
    const window = text.slice(Math.max(0, hit.normStart - 40), hit.normStart);
    if (BATCH_CONTEXT.test(window)) {
      return true;
    }
  }
  return false;
}

function toHit(hit: RawHit): AdditiveHit {
  const suffix = hit.suffix;
  return {
    code: `${hit.digits}${hit.letter ?? ''}${suffix ?? ''}`,
    suffix,
    scheme: hit.scheme,
    normStart: hit.normStart,
    normEnd: hit.normEnd,
  };
}

export function findAdditives(
  text: string,
  from: number,
  to: number,
  classContext: boolean,
): AdditiveHit[] {
  const found: AdditiveHit[] = [];
  let i = from;
  while (i < to) {
    const ch = text.charAt(i);
    let hit: RawHit | null = null;
    if (ch === 'I' || ch === 'i') {
      hit = readIns(text, i);
    } else if (ch === 'E' || ch === 'e') {
      hit = readE(text, i);
    } else if (isDigit(ch)) {
      hit = readPlain(text, i);
    }
    if (
      hit &&
      hit.normEnd <= to &&
      hit.normStart >= from &&
      !rejected(text, hit, classContext)
    ) {
      found.push(toHit(hit));
      i = hit.normEnd;
      continue;
    }
    i += 1;
  }
  return found;
}
