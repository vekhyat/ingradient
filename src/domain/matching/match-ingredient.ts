import index from './generated/taxonomy-index.json';
import { normaliseKey } from './normalise-key';

export type MatchIdentity =
  | {
      readonly state: 'matched';
      readonly canonicalId: string;
      readonly candidateIds: readonly [string];
    }
  | {
      readonly state: 'ambiguous';
      readonly canonicalId: null;
      readonly candidateIds: readonly string[];
    }
  | {
      readonly state: 'unresolved';
      readonly canonicalId: null;
      readonly candidateIds: readonly string[];
    };

export const MATCH_TAXONOMY_VERSION = `off-taxonomy-ingredients@${index.manifestRevision}`;
const ingredients: Readonly<Record<string, readonly string[]>> =
  index.ingredient;
const additives: Readonly<Record<string, readonly string[]>> = index.additive;

/** Identity comes only from names in the pinned taxonomy; never its relations. */
export function matchIngredient(
  text: string,
  {
    additiveContext = false,
    fuzzy = false,
  }: { additiveContext?: boolean; fuzzy?: boolean } = {},
): MatchIdentity {
  const key = normaliseKey(text);
  const code = /^(?:(e|ins)\s*)?(\d{3,4}[a-z]?(?:\s*\(\s*[ivx]+\s*\))?)$/i.exec(
    key,
  );
  let candidates: readonly string[];
  if (code) {
    if (!code[1] && !additiveContext) return unresolved();
    const number = code[2];
    if (number === undefined) return unresolved();
    const additiveKey = `e${number.replace(/\s+/g, '')}`;
    candidates = Object.hasOwn(additives, additiveKey)
      ? (additives[additiveKey] ?? [])
      : [];
  } else {
    candidates = [
      ...new Set([
        ...(Object.hasOwn(ingredients, key) ? (ingredients[key] ?? []) : []),
        ...(Object.hasOwn(additives, key) ? (additives[key] ?? []) : []),
      ]),
    ].sort();
    // Source names such as "1% fat milk" stay valid exact aliases. Only an
    // unmatched code-like spelling is barred from fuzzy code degradation.
    if (candidates.length === 0 && /^(?:(?:e|ins)\s*\d|\d)/i.test(key))
      return unresolved();
  }
  const first = candidates[0];
  if (candidates.length === 1 && first !== undefined) {
    return { state: 'matched', canonicalId: first, candidateIds: [first] };
  }
  if (candidates.length > 1)
    return { state: 'ambiguous', canonicalId: null, candidateIds: candidates };
  if (!fuzzy || key.length < 4 || code) return unresolved();
  const suggestions = new Set<string>();
  for (const scope of [ingredients, additives]) {
    for (const [alias, ids] of Object.entries(scope)) {
      if (
        Math.abs(alias.length - key.length) <= 1 &&
        distanceAtMostOne(key, alias)
      ) {
        for (const id of ids) suggestions.add(id);
      }
    }
  }
  return {
    state: 'unresolved',
    canonicalId: null,
    candidateIds: [...suggestions].sort().slice(0, 20),
  };
}

function unresolved(): MatchIdentity {
  return { state: 'unresolved', canonicalId: null, candidateIds: [] };
}

function distanceAtMostOne(a: string, b: string): boolean {
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length <= b.length) j += 1;
    if (a.length >= b.length) i += 1;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
