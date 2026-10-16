/**
 * Functional classes that introduce an additive number on a label.
 * Names follow EU Regulation 1169/2011 Annex VII and the Codex INS class list.
 * A bare number is an additive only in one of these contexts (BE-04).
 * https://eur-lex.europa.eu/eli/reg/2011/1169/oj
 */

const CLASS_PHRASES = [
  'acidity regulator',
  'acidity regulators',
  'anti-caking agent',
  'anti-caking agents',
  'anti-foaming agent',
  'anti-foaming agents',
  'anticaking agent',
  'anticaking agents',
  'antifoaming agent',
  'antifoaming agents',
  'antioxidant',
  'antioxidants',
  'bleaching agent',
  'bleaching agents',
  'bulking agent',
  'bulking agents',
  'carbonating agent',
  'carbonating agents',
  'carrier',
  'carriers',
  'color',
  'color retention agent',
  'color retention agents',
  'colors',
  'colour',
  'colour retention agent',
  'colour retention agents',
  'colours',
  'emulsifier',
  'emulsifiers',
  'emulsifying salt',
  'emulsifying salts',
  'firming agent',
  'firming agents',
  'flavor enhancer',
  'flavor enhancers',
  'flavour enhancer',
  'flavour enhancers',
  'flour treatment agent',
  'flour treatment agents',
  'foaming agent',
  'foaming agents',
  'gelling agent',
  'gelling agents',
  'glazing agent',
  'glazing agents',
  'humectant',
  'humectants',
  'preservative',
  'preservatives',
  'propellant',
  'propellants',
  'propellent',
  'propellents',
  'raising agent',
  'raising agents',
  'sequestrant',
  'sequestrants',
  'stabiliser',
  'stabilisers',
  'stabilizer',
  'stabilizers',
  'sweetener',
  'sweeteners',
  'thickener',
  'thickeners',
];

const PHRASES_BY_LENGTH = [...CLASS_PHRASES].sort(
  (left, right) => right.length - left.length,
);

const PREFIXES = ['permitted', 'artificial', 'natural', 'added', 'food'];

function stripQuotes(value: string): string {
  let head = value;
  while (head.startsWith('"') || head.startsWith("'")) {
    head = head.slice(1).trim();
  }
  while (head.endsWith('"') || head.endsWith("'")) {
    head = head.slice(0, -1).trim();
  }
  return head;
}

function stripPrefix(head: string): string {
  for (const prefix of PREFIXES) {
    if (head === prefix) {
      return '';
    }
    if (head.startsWith(`${prefix} `)) {
      return head.slice(prefix.length).trim();
    }
  }
  const classRoman = /^class\s+[ivx]+\s+/.exec(head);
  if (classRoman) {
    return head.slice(classRoman[0].length).trim();
  }
  return head;
}

/** Lowercase class phrase printed at the start of `name`, or null. */
export function matchAdditiveClass(name: string): string | null {
  let head = stripQuotes(name.toLowerCase().replace(/\s+/g, ' ').trim());
  head = head.replace(/[.:]+$/g, '').trim();
  if (head.length === 0 || /\bfree\b/.test(head)) {
    return null;
  }
  for (let guard = 0; guard < 6; guard += 1) {
    const next = stripPrefix(head);
    if (next === head) {
      break;
    }
    head = next;
  }
  if (head.length === 0 || /\bfree\b/.test(head)) {
    return null;
  }
  for (const phrase of PHRASES_BY_LENGTH) {
    if (
      head === phrase ||
      head.startsWith(`${phrase} `) ||
      head.startsWith(`${phrase}:`)
    ) {
      return phrase;
    }
  }
  return null;
}
