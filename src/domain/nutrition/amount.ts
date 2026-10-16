import { decimalFromParts, formatDecimal, type Decimal } from './decimal';
import { canonicalUnit, cleanLabel, type AmountUnit } from './units';

/**
 * How a single nutrition cell becomes a number.
 *
 * Nil is a declared zero. A dash is not: the row was printed, but no quantity
 * was printed. Trace, "not detected", and any "<" or "≤" bound are uncertain.
 * The bound is stored so the cell can be shown, and it is not a measurement
 * equal to that bound. "0 g" is a declared zero.
 *
 * A comma or a dot is a decimal mark only when that reading is unambiguous.
 * "0,5" is 0.5. "1,000" and "1.234" are left unresolved.
 * Glyph repairs (O/0, l/1, S/5) run only inside a token that is otherwise a
 * number. The word "Salt" is never rewritten.
 */
export type Bound = 'none' | 'lt' | 'lte' | 'gt' | 'gte';

export interface QuantityToken {
  decimal: Decimal;
  unit: AmountUnit | null;
  bound: Bound;
  approximate: boolean;
  repairs: readonly string[];
  printed: string;
}

export type ParsedCell =
  | { status: 'empty' }
  | { status: 'nil' }
  | { status: 'dash' }
  | { status: 'not_applicable' }
  | { status: 'trace' }
  | { status: 'not_detected' }
  | { status: 'quantity'; quantities: readonly QuantityToken[] }
  | { status: 'ambiguous'; code: string; message: string }
  | { status: 'unreadable'; message: string };

const UNIT_PATTERN =
  'micrograms?|milligrams?|kilocalories|kilojoules|µg|μg|mcg|ug|mg|grams?|gms?|kcal|kj|g|percent|%';

export function interpretNumberToken(token: string): Decimal | 'ambiguous' {
  const text = token.trim();
  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(text)) {
    const split = text.split(',');
    const intPart = (split[0] ?? '').replace(/\./g, '');
    return decimalFromParts(intPart, split[1] ?? '');
  }
  if (/^\d{1,3}(?:\.\d{3}){2,}$/.test(text)) {
    return decimalFromParts(text.replace(/\./g, ''), '');
  }
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text)) {
    const commas = text.match(/,/g)?.length ?? 0;
    const head = text.split(',')[0] ?? '';
    if (commas === 1 && !text.includes('.') && head === '0') {
      return decimalFromParts(head, text.slice(head.length + 1));
    }
    if (commas >= 2 || text.includes('.')) {
      const plain = text.replace(/,/g, '');
      const split = plain.split('.');
      return decimalFromParts(split[0] ?? '', split[1] ?? '');
    }
    return 'ambiguous';
  }
  if (/^\d+\.\d+$/.test(text)) {
    const split = text.split('.');
    const intPart = split[0] ?? '';
    const frac = split[1] ?? '';
    if (frac.length === 3 && intPart !== '0') {
      return 'ambiguous';
    }
    return decimalFromParts(intPart, frac);
  }
  if (/^\d+,\d+$/.test(text)) {
    const split = text.split(',');
    const intPart = split[0] ?? '';
    const frac = split[1] ?? '';
    if (frac.length === 3 && intPart !== '0') {
      return 'ambiguous';
    }
    return decimalFromParts(intPart, frac);
  }
  if (/^\d+$/.test(text)) {
    return decimalFromParts(text, '');
  }
  return 'ambiguous';
}

export function repairAmountText(
  input: string,
): { text: string; repairs: readonly string[] } | { error: string } {
  let text = input
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[*†‡]/g, '');
  text = text.replace(/(\d)\s+([.,])\s*(?=\d)/g, '$1$2');
  text = text.replace(/([.,])\s+(\d)/g, '$1$2');
  text = text.replace(/\d{1,3}(?: \d{3})+(?!\d)/g, (group) =>
    group.replace(/ /g, ''),
  );
  if (/\d \d/.test(text)) {
    return {
      error:
        'Digits are separated by a space, and those groups are not thousands.',
    };
  }
  const repairs: string[] = [];
  text = text.replace(/[0-9OoIl|iIsS.,]+/g, (run) => {
    if (!/[0-9]/.test(run) || !/[OoIl|iIsS]/.test(run)) {
      return run;
    }
    const mapped = run
      .replace(/[Oo]/g, '0')
      .replace(/[Il|i]/g, '1')
      .replace(/[Ss]/g, '5');
    repairs.push(`${run} read as ${mapped}`);
    return mapped;
  });
  return { text, repairs };
}

export function parseAmountCell(raw: string): ParsedCell {
  const marker = cleanLabel(raw);
  if (marker.length === 0) {
    return { status: 'empty' };
  }
  if (/^[-–—−]+$/.test(marker)) {
    return { status: 'dash' };
  }
  if (/^(?:nil|nill)$/.test(marker)) {
    return { status: 'nil' };
  }
  if (/^(?:trace|traces|tr)$/.test(marker)) {
    return { status: 'trace' };
  }
  if (/^(?:nd|n\.d\.|not detected)$/.test(marker)) {
    return { status: 'not_detected' };
  }
  if (/^(?:n\/a|not applicable)$/.test(marker)) {
    return { status: 'not_applicable' };
  }

  const repaired = repairAmountText(raw);
  if ('error' in repaired) {
    return {
      status: 'ambiguous',
      code: 'ambiguous_number',
      message: repaired.error,
    };
  }
  const prefixed = takePrefix(repaired.text.trim());
  if (/^[-–—−]\s*\d/.test(prefixed.rest)) {
    return {
      status: 'ambiguous',
      code: 'signed_amount',
      message:
        'A leading minus before a number is not a nutrition amount and is not a dash.',
    };
  }

  const pattern = new RegExp(`(\\d[\\d.,]*)\\s*(${UNIT_PATTERN})?`, 'giu');
  const quantities: QuantityToken[] = [];
  let cursor = 0;
  let leftover = '';
  for (const match of prefixed.rest.matchAll(pattern)) {
    const full = match[0] ?? '';
    const start = match.index ?? 0;
    leftover += prefixed.rest.slice(cursor, start);
    cursor = start + full.length;
    const interpreted = interpretNumberToken(match[1] ?? '');
    if (interpreted === 'ambiguous') {
      return {
        status: 'ambiguous',
        code: 'ambiguous_number',
        message: `"${match[1] ?? ''}" can be read as more than one number.`,
      };
    }
    const unit = match[2] === undefined ? null : canonicalUnit(match[2]);
    if (match[2] !== undefined && unit === null) {
      return {
        status: 'unreadable',
        message: `Unrecognised unit "${match[2]}".`,
      };
    }
    quantities.push({
      decimal: interpreted,
      unit,
      bound: prefixed.bound,
      approximate: prefixed.approximate,
      repairs: repaired.repairs,
      printed: formatDecimal(interpreted),
    });
  }
  leftover += prefixed.rest.slice(cursor);
  const noise = leftover
    .replace(/[\\/|,;:+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (noise.length > 0) {
    return {
      status: 'unreadable',
      message: `Could not read "${raw.trim()}".`,
    };
  }
  if (quantities.length === 0) {
    return { status: 'unreadable', message: `Could not read "${raw.trim()}".` };
  }
  return { status: 'quantity', quantities };
}

function takePrefix(text: string): {
  bound: Bound;
  approximate: boolean;
  rest: string;
} {
  let rest = text;
  let approximate = false;
  const approximateMatch = /^(?:~|≈|approx(?:imately)?|about|ca\.)\s*/i.exec(
    rest,
  );
  if (approximateMatch) {
    approximate = true;
    rest = rest.slice(approximateMatch[0].length).trim();
  }
  const word =
    /^(less than or equal to|not more than|no more than|at most|greater than or equal to|not less than|at least|less than|lower than|below|under|greater than|more than)\s+/i.exec(
      rest,
    );
  if (word) {
    const phrase = (word[1] ?? '').toLowerCase();
    const bound: Bound =
      phrase === 'less than' ||
      phrase === 'lower than' ||
      phrase === 'below' ||
      phrase === 'under'
        ? 'lt'
        : phrase === 'greater than' || phrase === 'more than'
          ? 'gt'
          : phrase === 'at least' ||
              phrase === 'not less than' ||
              phrase === 'greater than or equal to'
            ? 'gte'
            : 'lte';
    return { bound, approximate, rest: rest.slice(word[0].length).trim() };
  }
  const symbol = /^(<=|>=|≤|≥|<|>)\s*/.exec(rest);
  if (symbol) {
    const token = symbol[1] ?? '';
    const bound: Bound =
      token === '<'
        ? 'lt'
        : token === '>'
          ? 'gt'
          : token === '>=' || token === '≥'
            ? 'gte'
            : 'lte';
    return { bound, approximate, rest: rest.slice(symbol[0].length).trim() };
  }
  return { bound: 'none', approximate, rest };
}
