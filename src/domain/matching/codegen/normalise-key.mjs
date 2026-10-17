/**
 * Exact source alias key: lowercase and collapse whitespace only.
 * Preserve punctuation, diacritics and meaningful suffix parentheses.
 * Runtime counterpart: ../normalise-key.ts. Regeneration and matcher tests
 * verify the resulting aliases rather than broadening them by punctuation.
 */
export function normaliseKey(name) {
  return name.toLowerCase().replace(/\s+/gu, ' ').trim();
}
