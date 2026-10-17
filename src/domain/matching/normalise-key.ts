/** Exact alias keys preserve punctuation, suffixes and diacritics. */
export function normaliseKey(name: string): string {
  return name.toLowerCase().replace(/\s+/gu, ' ').trim();
}
