import type { TextSpan } from './types';

/**
 * Normalised view of a label. `normalized[i]` was copied from
 * `original[origin[i]]`. Characters dropped for parsing (soft hyphens,
 * zero-width marks, a hyphenation break) leave a gap in `origin`. A span
 * built from the first and last kept index still covers those gaps, so the
 * UI highlights the original ink.
 */
export interface PreparedText {
  original: string;
  normalized: string;
  origin: number[];
}

const UNICODE_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/;

/**
 * Words that are already complete. A line break before one of these is a
 * wrap between words, not a broken token. This is an OCR guard, not the
 * ingredient taxonomy (MAT-01 owns that).
 */
const COMPLETE_SHORT_WORDS = new Set([
  'acid',
  'atta',
  'besan',
  'bran',
  'butter',
  'cocoa',
  'corn',
  'cream',
  'curd',
  'dahi',
  'dal',
  'egg',
  'eggs',
  'fat',
  'flour',
  'ghee',
  'gum',
  'honey',
  'jaggery',
  'maida',
  'malt',
  'milk',
  'nut',
  'nuts',
  'oat',
  'oats',
  'oil',
  'palm',
  'paneer',
  'ragi',
  'rice',
  'salt',
  'seed',
  'seeds',
  'soy',
  'spice',
  'spices',
  'starch',
  'sugar',
  'syrup',
  'tea',
  'water',
  'wheat',
  'yeast',
]);

const FUNCTION_WORDS = new Set([
  'a',
  'an',
  'and',
  'as',
  'by',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'per',
  'the',
  'to',
  'with',
]);

function pushChar(
  chars: string[],
  origin: number[],
  ch: string,
  index: number,
): void {
  chars.push(ch);
  origin.push(index);
}

function isAsciiLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isLowerLetter(ch: string): boolean {
  return ch >= 'a' && ch <= 'z';
}

function isIgnored(ch: string): boolean {
  return (
    ch === '\u00AD' ||
    ch === '\u200B' ||
    ch === '\u200C' ||
    ch === '\u200D' ||
    ch === '\uFEFF'
  );
}

function isBreak(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
}

function isDash(ch: string): boolean {
  return (
    ch === '-' ||
    ch === '\u2010' ||
    ch === '\u2011' ||
    ch === '\u2012' ||
    ch === '\u2013' ||
    ch === '\u2014' ||
    ch === '\u2212'
  );
}

function nextSignificant(original: string, index: number): number {
  let i = index;
  while (i < original.length) {
    const ch = original.charAt(i);
    if (isBreak(ch) || isIgnored(ch)) {
      i += 1;
      continue;
    }
    return i;
  }
  return -1;
}

function hyphenBeforeBreak(original: string, breakIndex: number): boolean {
  let i = breakIndex - 1;
  while (i >= 0 && isIgnored(original.charAt(i))) {
    i -= 1;
  }
  if (i < 0 || !isDash(original.charAt(i))) {
    return false;
  }
  let j = i - 1;
  while (j >= 0 && isIgnored(original.charAt(j))) {
    j -= 1;
  }
  return j >= 0 && isAsciiLetter(original.charAt(j));
}

function wordAtEnd(chars: string[]): string {
  let i = chars.length;
  while (i > 0 && isAsciiLetter(chars[i - 1] ?? '')) {
    i -= 1;
  }
  return chars.slice(i).join('').toLowerCase();
}

function wordAt(original: string, index: number): string {
  let i = index;
  while (i < original.length && isAsciiLetter(original.charAt(i))) {
    i += 1;
  }
  return original.slice(index, i).toLowerCase();
}

function shouldJoinBrokenWord(
  original: string,
  chars: string[],
  nextIndex: number,
): boolean {
  if (chars.length === 0 || nextIndex < 0) {
    return false;
  }
  const prev = chars[chars.length - 1] ?? '';
  const next = original.charAt(nextIndex);
  if (!isLowerLetter(prev) || !isLowerLetter(next)) {
    return false;
  }
  const left = wordAtEnd(chars);
  const right = wordAt(original, nextIndex);
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  if (FUNCTION_WORDS.has(left) || FUNCTION_WORDS.has(right)) {
    return false;
  }
  if (COMPLETE_SHORT_WORDS.has(left) || COMPLETE_SHORT_WORDS.has(right)) {
    return false;
  }
  return Math.min(left.length, right.length) <= 3;
}

function emitBreak(
  original: string,
  breakIndex: number,
  chars: string[],
  origin: number[],
): void {
  if (chars.length > 0 && chars[chars.length - 1] === '\n') {
    return;
  }
  const nextIndex = nextSignificant(original, breakIndex + 1);
  const next = nextIndex >= 0 ? original.charAt(nextIndex) : '';
  if (hyphenBeforeBreak(original, breakIndex) && isAsciiLetter(next)) {
    if (chars[chars.length - 1] === '-') {
      chars.pop();
      origin.pop();
    }
    return;
  }
  if (shouldJoinBrokenWord(original, chars, nextIndex)) {
    return;
  }
  if (chars.length > 0) {
    pushChar(chars, origin, '\n', breakIndex);
  }
}

function normaliseChar(ch: string): string {
  if (UNICODE_SPACE.test(ch) || ch === '\t') {
    return ' ';
  }
  if (
    ch === '\u2018' ||
    ch === '\u2019' ||
    ch === '\u201A' ||
    ch === '\u2032'
  ) {
    return "'";
  }
  if (
    ch === '\u201C' ||
    ch === '\u201D' ||
    ch === '\u201E' ||
    ch === '\u2033'
  ) {
    return '"';
  }
  if (isDash(ch)) {
    return '-';
  }
  if (ch === '\uFF08') {
    return '(';
  }
  if (ch === '\uFF09') {
    return ')';
  }
  if (ch === '\uFF3B') {
    return '[';
  }
  if (ch === '\uFF3D') {
    return ']';
  }
  if (ch === '\uFF5B') {
    return '{';
  }
  if (ch === '\uFF5D') {
    return '}';
  }
  if (ch === '\uFF0C') {
    return ',';
  }
  if (ch === '\uFF1B') {
    return ';';
  }
  if (ch === '\uFF1A') {
    return ':';
  }
  if (ch === '\uFF05') {
    return '%';
  }
  return ch;
}

export function prepareLabelText(original: string): PreparedText {
  const chars: string[] = [];
  const origin: number[] = [];
  let i = 0;
  while (i < original.length) {
    const ch = original.charAt(i);
    if (ch === '\r') {
      emitBreak(original, i, chars, origin);
      i += original.charAt(i + 1) === '\n' ? 2 : 1;
      continue;
    }
    if (isBreak(ch)) {
      emitBreak(original, i, chars, origin);
      i += 1;
      continue;
    }
    if (isIgnored(ch)) {
      i += 1;
      continue;
    }
    pushChar(chars, origin, normaliseChar(ch), i);
    i += 1;
  }
  return { original, normalized: chars.join(''), origin };
}

export function spanFrom(
  prepared: PreparedText,
  start: number,
  end: number,
): TextSpan {
  if (prepared.origin.length === 0 || start >= prepared.origin.length) {
    const at = prepared.original.length;
    return { start: at, end: at };
  }
  const originStart = prepared.origin[start] ?? prepared.original.length;
  if (end <= start) {
    return { start: originStart, end: originStart };
  }
  const lastIndex = Math.min(end, prepared.origin.length) - 1;
  const originLast = prepared.origin[lastIndex] ?? originStart;
  return { start: originStart, end: originLast + 1 };
}
