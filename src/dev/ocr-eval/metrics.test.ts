import { expect, test } from '@jest/globals';

import {
  parseGroundTruth,
  parseRun,
  parseSplit,
  type GroundTruth,
  type RunConfig,
} from './dataset';
import {
  editDistance,
  normaliseText,
  overlap,
  scorePhoto,
  summarise,
} from './metrics';
import { buildEvalResult } from './pipeline';
import { parseEvalResult } from './read-result';

const run: RunConfig = {
  runId: 'synthetic',
  split: 'dev',
  pipelineRevision: 'test-only',
  freeze: '',
};
function read(text: string) {
  return buildEvalResult({
    id: 'fictional',
    imageSha256: '0'.repeat(64),
    run,
    capturedAt: '2026-10-16T00:00:00Z',
    elapsedMs: 1,
    outcome: {
      status: 'read',
      page: {
        blocks: [
          { text, box: null, lines: [{ text, box: null, languages: ['en'] }] },
        ],
      },
    },
  });
}
const gold: GroundTruth = {
  ingredientsText: 'Ingredients: oats, sugar, salt',
  nutrition: [],
};

test('normalisation retains meaningful INS digits and suffix letters', () => {
  expect(normaliseText(' INS 503(ii),  12%\nOATS ')).toBe('ins 503 ii 12 oats');
  expect(normaliseText('ＡＢＣ')).toBe('abc');
});

test('edit distance handles insertions, deletion, substitution and code points', () => {
  expect(editDistance('sugar', 'sugor')).toBe(1);
  expect(editDistance('ab', 'a')).toBe(1);
  expect(editDistance('', 'abc')).toBe(3);
  expect(editDistance('a', 'abcd')).toBe(3);
  expect(editDistance('😀', '')).toBe(1);
  expect(editDistance('oats', 'oats')).toBe(0);
});

test('word overlap is a bag: duplicate predictions do not earn extra matches', () => {
  expect(overlap(['oats', 'salt'], ['oats', 'oats'])).toEqual({
    matched: 1,
    expected: 2,
    predicted: 2,
  });
});

test('perfect text and names score 1; heading, case and punctuation are ignored', () => {
  const summary = summarise([
    scorePhoto(gold, read('INGREDIENTS: Oats; sugar; salt.')),
  ]);
  expect(summary.ingredients.cer).toBe(0);
  expect(summary.ingredients.words.f1).toBe(1);
  expect(summary.ingredients.mentions.recall).toBe(1);
});

test('blank and engine failures remain in the denominator; missing never becomes zero', () => {
  const blank = buildEvalResult({
    id: 'blank',
    imageSha256: '0'.repeat(64),
    run,
    capturedAt: '2026-10-16T00:00:00Z',
    elapsedMs: 1,
    outcome: { status: 'no_text' },
  });
  const failed = buildEvalResult({
    id: 'failed',
    imageSha256: '0'.repeat(64),
    run,
    capturedAt: '2026-10-16T00:00:00Z',
    elapsedMs: 1,
    outcome: { status: 'engine_error', message: 'synthetic error' },
  });
  const summary = summarise([
    scorePhoto(gold, blank),
    scorePhoto(gold, failed),
  ]);
  expect(summary.photos).toBe(2);
  expect(summary.ingredients.cer).toBe(1);
  expect(summary.ingredients.words.f1).toBe(0);
  expect(summary.ingredients.mentions.recall).toBe(0);
  expect(summary.panels).toMatchObject({
    ingredientMissed: 2,
    noText: 1,
    engineError: 1,
  });
  expect(
    blank.snapshot.observations.every((row) => row.kind === 'missing'),
  ).toBe(true);
});

test('empty denominators are null, not a perfect score', () => {
  expect(summarise([]).ingredients.cer).toBeNull();
  expect(summarise([]).ingredients.words.f1).toBeNull();
  expect(summarise([]).nutrition.valueAccuracy).toBeNull();
});

test('stored baselines survive later parser changes and malformed results fail', () => {
  const baseline = read('Ingredients: oats');
  expect(parseEvalResult(JSON.parse(JSON.stringify(baseline)))).toEqual(
    baseline,
  );
  expect(() =>
    parseEvalResult({ ...baseline, imageSha256: 'wrong' }),
  ).toThrow();
  expect(() => parseEvalResult({ ...baseline, snapshot: {} })).toThrow();
  expect(() =>
    parseEvalResult({ ...baseline, outcome: { status: 'read', page: {} } }),
  ).toThrow();
  expect(() => parseEvalResult({ ...baseline, elapsedMs: -1 })).toThrow();
});

test('nutrition checks value, basis and uncertainty without credit for conflicting duplicates', () => {
  const result = read('Ingredients: oats');
  const target: GroundTruth = {
    ingredientsText: null,
    nutrition: [{ field: 'sugars', value: 24, unit: 'g', basis: 'per_100_g' }],
  };
  const row = {
    field: 'sugars',
    kind: 'read',
    value: 24.05,
    unit: 'g',
    basis: 'per_100_g',
    sourceIds: ['synthetic'],
    issues: [],
  } as const;
  result.snapshot.observations = [
    { ...row, sourceIds: ['synthetic'], issues: [] },
  ];
  expect(scorePhoto(target, result).nutrition).toMatchObject({
    found: 1,
    correct: 1,
  });
  result.snapshot.observations = [
    { ...row, value: 24.06, sourceIds: ['synthetic'], issues: [] },
  ];
  expect(scorePhoto(target, result).nutrition.correct).toBe(0);
  result.snapshot.observations = [
    { ...row, basis: 'per_serving', sourceIds: ['synthetic'], issues: [] },
  ];
  expect(scorePhoto(target, result).nutrition.found).toBe(0);
  result.snapshot.observations = [
    {
      ...row,
      kind: 'uncertain',
      sourceIds: ['synthetic'],
      issues: [
        {
          code: 'synthetic',
          message: 'Synthetic uncertainty',
          stage: 'extraction',
          action: 'retake',
        },
      ],
    },
  ];
  expect(scorePhoto(target, result).nutrition).toMatchObject({
    found: 1,
    correct: 0,
    uncertain: 1,
  });
  result.snapshot.observations = [
    { ...row, sourceIds: ['synthetic'], issues: [] },
    { ...row, sourceIds: ['synthetic'], issues: [] },
  ];
  expect(scorePhoto(target, result).nutrition.correct).toBe(0);
});

test('printed mg and kcal compare in printed units after parser normalisation', () => {
  const result = read('Ingredients: oats');
  result.snapshot.observations = [
    {
      field: 'sodium',
      kind: 'read',
      value: 0.1,
      unit: 'g',
      basis: 'per_100_g',
      sourceIds: ['synthetic'],
      issues: [],
    },
    {
      field: 'energy',
      kind: 'read',
      value: 418.4,
      unit: 'kJ',
      basis: 'per_100_g',
      sourceIds: ['synthetic'],
      issues: [],
    },
  ];
  const target: GroundTruth = {
    ingredientsText: null,
    nutrition: [
      { field: 'sodium', value: 100, unit: 'mg', basis: 'per_100_g' },
      { field: 'energy', value: 100, unit: 'kcal', basis: 'per_100_g' },
    ],
  };
  expect(scorePhoto(target, result).nutrition.correct).toBe(2);
});

test('split validation rejects duplicates, leakage, unsafe paths and empty sets', () => {
  expect(parseSplit({ dev: ['a'], holdout: ['b'] }).dev).toEqual(['a']);
  for (const value of [
    { dev: ['a'], holdout: ['a'] },
    { dev: ['a', 'a'], holdout: ['b'] },
    { dev: ['../a'], holdout: ['b'] },
    { dev: [], holdout: ['b'] },
  ]) {
    expect(() => parseSplit(value)).toThrow();
  }
});

test('holdout requires freeze and human nutrition rows must be valid and unique', () => {
  expect(() => parseRun({ ...run, split: 'holdout' })).toThrow(/Freeze/);
  expect(
    parseRun({ ...run, split: 'holdout', freeze: 'frozen-candidate-1' }).split,
  ).toBe('holdout');
  expect(parseGroundTruth(gold)).toEqual(gold);
  expect(() =>
    parseGroundTruth({
      ...gold,
      nutrition: [
        { field: 'carbohydrate', value: 1, unit: 'g', basis: 'per_100_g' },
      ],
    }),
  ).toThrow();
  const row = { field: 'sugars', value: 1, unit: 'g', basis: 'per_100_g' };
  expect(() => parseGroundTruth({ ...gold, nutrition: [row, row] })).toThrow(
    /Duplicate/,
  );
});
