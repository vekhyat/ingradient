import type { NutrientObservation } from '../../domain/contracts/generated/local';
import { parseIngredients } from '../../domain/ingredients';
import type { GroundTruth } from './dataset';
import type { EvalResult } from './pipeline';

/** NFKC, lowercase, punctuation -> spaces, whitespace collapsed. Keep digits and INS suffix letters. */
export function normaliseText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function ingredientText(text: string): string {
  return normaliseText(
    text.replace(/^\s*(?:list\s+of\s+)?ingredients?\s*:?\s*/i, ''),
  );
}

/** Levenshtein over Unicode code points; one row of memory, no OCR dependency. */
export function editDistance(expected: string, actual: string): number {
  const a = Array.from(expected);
  const b = Array.from(actual);
  let previous = b.map((_, index) => index + 1);
  previous.unshift(0);
  for (const [i, left] of a.entries()) {
    const current = [i + 1];
    for (const [j, right] of b.entries()) {
      current.push(
        Math.min(
          (current[j] ?? 0) + 1,
          (previous[j + 1] ?? 0) + 1,
          (previous[j] ?? 0) + (left === right ? 0 : 1),
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

export function overlap(
  expected: readonly string[],
  actual: readonly string[],
) {
  const remaining = new Map<string, number>();
  expected.forEach((word) =>
    remaining.set(word, (remaining.get(word) ?? 0) + 1),
  );
  let matched = 0;
  actual.forEach((word) => {
    const count = remaining.get(word) ?? 0;
    if (count > 0) {
      matched += 1;
      remaining.set(word, count - 1);
    }
  });
  return { matched, expected: expected.length, predicted: actual.length };
}

type Counts = ReturnType<typeof overlap>;
function ratios(counts: Counts) {
  return {
    ...counts,
    precision: counts.predicted ? counts.matched / counts.predicted : null,
    recall: counts.expected ? counts.matched / counts.expected : null,
    f1:
      counts.expected + counts.predicted
        ? (2 * counts.matched) / (counts.expected + counts.predicted)
        : null,
  };
}

export function ingredientNames(text: string): string[] {
  return [
    ...new Set(
      parseIngredients(text)
        .mentions.filter(
          (mention) =>
            mention.role === 'ingredient' || mention.role === 'additive',
        )
        .map((mention) => normaliseText(mention.name))
        .filter(Boolean),
    ),
  ];
}

function valueInPrintedUnit(
  row: NutrientObservation,
  unit: GroundTruth['nutrition'][number]['unit'],
): number | null {
  if (row.kind !== 'read') return null;
  if (row.unit === unit) return row.value;
  // The production parser normalises printed mg and kcal into g and kJ.
  if (row.unit === 'g' && unit === 'mg') return row.value * 1000;
  if (row.unit === 'kJ' && unit === 'kcal') return row.value / 4.184;
  return null;
}

export function scorePhoto(gold: GroundTruth, result: EvalResult) {
  const expected = ingredientText(gold.ingredientsText ?? '');
  const actual = ingredientText(result.panels.ingredientsText ?? '');
  const words = (text: string) => (text ? text.split(' ') : []);
  const valued = result.snapshot.observations.filter(
    (row) => row.kind === 'read' || row.kind === 'uncertain',
  );
  let found = 0;
  let correct = 0;
  for (const target of gold.nutrition) {
    const candidates = valued.filter(
      (row) => row.field === target.field && row.basis === target.basis,
    );
    if (candidates.length > 0) found += 1;
    // Conflicting duplicates cannot get credit by choosing whichever matches gold.
    if (candidates.length === 1) {
      const row = candidates[0];
      const value = row ? valueInPrintedUnit(row, target.unit) : null;
      if (value !== null && Math.abs(value - target.value) <= 0.05 + 1e-9)
        correct += 1;
    }
  }
  return {
    characters: Array.from(expected).length,
    edits: editDistance(expected, actual),
    words: overlap(words(expected), words(actual)),
    mentions: overlap(ingredientNames(gold.ingredientsText ?? ''), [
      ...new Set(
        result.snapshot.ingredients.map((mention) =>
          normaliseText(mention.text),
        ),
      ),
    ]),
    nutrition: {
      expected: gold.nutrition.length,
      predicted: valued.length,
      found,
      correct,
      uncertain: valued.filter((row) => row.kind === 'uncertain').length,
    },
    panels: {
      ingredientExpected: gold.ingredientsText !== null,
      ingredientFound: result.panels.ingredientsText !== null,
      noText: result.outcome.status === 'no_text',
      neither:
        result.outcome.status === 'read' &&
        result.panels.ingredientsText === null &&
        result.panels.nutritionFragments.length === 0,
      engineError: result.outcome.status === 'engine_error',
      unsupported: result.outcome.status === 'unsupported_language',
    },
  };
}

/** Pooled development diagnostics, not the formal RSH-01 ingredient-ID F1. */
export function summarise(scores: ReturnType<typeof scorePhoto>[]) {
  const sum = (pick: (row: ReturnType<typeof scorePhoto>) => number) =>
    scores.reduce((n, row) => n + pick(row), 0);
  const combine = (key: 'words' | 'mentions') =>
    ratios({
      matched: sum((row) => row[key].matched),
      expected: sum((row) => row[key].expected),
      predicted: sum((row) => row[key].predicted),
    });
  const characters = sum((row) => row.characters);
  const edits = sum((row) => row.edits);
  const expectedFields = sum((row) => row.nutrition.expected);
  const found = sum((row) => row.nutrition.found);
  const correct = sum((row) => row.nutrition.correct);
  return {
    photos: scores.length,
    ingredients: {
      characters,
      edits,
      cer: characters ? edits / characters : null,
      words: combine('words'),
      mentions: combine('mentions'),
    },
    nutrition: {
      expected: expectedFields,
      found,
      correct,
      predicted: sum((row) => row.nutrition.predicted),
      uncertain: sum((row) => row.nutrition.uncertain),
      fieldRecall: expectedFields ? found / expectedFields : null,
      valueAccuracy: expectedFields ? correct / expectedFields : null,
      accuracyAmongFound: found ? correct / found : null,
    },
    panels: {
      ingredientExpected: sum((row) => Number(row.panels.ingredientExpected)),
      ingredientFound: sum((row) =>
        Number(row.panels.ingredientExpected && row.panels.ingredientFound),
      ),
      ingredientMissed: sum((row) =>
        Number(row.panels.ingredientExpected && !row.panels.ingredientFound),
      ),
      ingredientFalsePositive: sum((row) =>
        Number(!row.panels.ingredientExpected && row.panels.ingredientFound),
      ),
      noText: sum((row) => Number(row.panels.noText)),
      neither: sum((row) => Number(row.panels.neither)),
      engineError: sum((row) => Number(row.panels.engineError)),
      unsupported: sum((row) => Number(row.panels.unsupported)),
    },
  };
}
