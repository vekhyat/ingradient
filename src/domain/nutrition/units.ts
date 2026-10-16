export type AmountUnit = 'g' | 'mg' | 'mcg' | 'kcal' | 'kJ' | 'percent';

export function cleanLabel(text: string): string {
  const cleaned = text
    .normalize('NFKC')
    .replace(/\u00a0/g, ' ')
    .replace(/[*†‡]/g, '')
    .toLowerCase()
    .replace(/\s*:\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]+$/, '');
  return stripLeadingListMarker(cleaned);
}

/**
 * "- of which sugars" is a sub-row. A cell that is only "-" or "—" is a dash,
 * so the marker is removed only when text remains after it.
 */
function stripLeadingListMarker(text: string): string {
  let current = text;
  for (let guard = 0; guard < 4; guard += 1) {
    const stripped = current.replace(/^(?:[-–—−•·\\]+)\s*/, '');
    if (stripped.length === 0 || stripped === current) {
      return current;
    }
    current = stripped.trim();
  }
  return current;
}

export function canonicalUnit(raw: string): AmountUnit | null {
  const unit = raw.toLowerCase();
  if (
    unit === 'g' ||
    unit === 'gm' ||
    unit === 'gms' ||
    unit === 'gram' ||
    unit === 'grams'
  ) {
    return 'g';
  }
  if (unit === 'mg' || unit === 'milligram' || unit === 'milligrams') {
    return 'mg';
  }
  if (
    unit === 'mcg' ||
    unit === 'ug' ||
    unit === 'µg' ||
    unit === 'μg' ||
    unit === 'microgram' ||
    unit === 'micrograms'
  ) {
    return 'mcg';
  }
  if (unit === 'kcal' || unit === 'kilocalorie' || unit === 'kilocalories') {
    return 'kcal';
  }
  if (unit === 'kj' || unit === 'kilojoule' || unit === 'kilojoules') {
    return 'kJ';
  }
  if (unit === '%' || unit === 'percent') {
    return 'percent';
  }
  return null;
}
