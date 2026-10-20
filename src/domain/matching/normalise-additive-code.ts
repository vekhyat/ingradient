import { normaliseKey } from './normalise-key';

/** Numeric lookup identity only; the parser retains the original printed form. */
export function normaliseAdditiveCode(text: string): string | null {
  const match =
    /^(?:(?:e|ins)\s*)?(\d{3,4})([a-f])?(?:\s*\(\s*([a-f]|[ivxlcdm]+)\s*\))?$/.exec(
      normaliseKey(text),
    );
  if (!match?.[1]) return null;
  const letter = match[2] ?? '';
  const suffix = match[3];
  if (!suffix) return `${match[1]}${letter}`;
  if (/^[a-f]$/.test(suffix)) {
    // A second letter suffix must not collapse into a known identity.
    return letter ? null : `${match[1]}${suffix}`;
  }
  return `${match[1]}${letter}(${suffix})`;
}
