import { describe, expect, it } from '@jest/globals';
import manifestJson from '../../../resources/manifest.json';
import methodJson from '../../../resources/method/nutriscore-updated-2023.json';
import { PINNED_METHOD, loadMethodBundle } from './method-bundle';
import { calculateNutriScore, calculateWithMethod } from './nutri-score';
import type {
  DeclaredAmount,
  FactState,
  NutriScoreInput,
  NutriScoreNutrient,
  NutriScoreResult,
  ScoringFactStates,
} from './types';

const g = (value: number): DeclaredAmount => ({
  value,
  unit: 'g',
  basis: 'per_100_g',
});

const KNOWN: ScoringFactStates = {
  cheese: 'absent',
  redMeat: 'absent',
  plainWater: 'absent',
  nonNutritiveSweetener: 'absent',
};

/** Lentil meal from vector-general-mid: graded A, score -1. */
const GENERAL: NutriScoreInput = {
  category: 'general',
  facts: KNOWN,
  nutrients: {
    energy: { value: 450, unit: 'kJ', basis: 'per_100_g' },
    sugars: g(4),
    saturates: g(0.5),
    salt: g(0.8),
    protein: g(6),
    fibre: g(4.5),
    fvl: { value: 65, unit: 'percent', basis: 'per_100_g' },
  },
};

/** High Points A (>= 11) with protein points, so the cheese rule matters. */
const HIGH_A: NutriScoreInput = {
  ...GENERAL,
  nutrients: {
    ...GENERAL.nutrients,
    energy: { value: 1600, unit: 'kJ', basis: 'per_100_g' },
    saturates: g(10),
    salt: g(1.5),
    protein: g(20),
    fibre: g(0),
    fvl: { value: 0, unit: 'percent', basis: 'per_100_g' },
  },
};

const ml = (value: number, unit: 'g' | 'kJ' = 'g'): DeclaredAmount => ({
  value,
  unit,
  basis: 'per_100_ml',
});

const DRINK: NutriScoreInput = {
  category: 'beverage',
  facts: KNOWN,
  nutrients: {
    energy: ml(100, 'kJ'),
    sugars: ml(5),
    saturates: ml(0),
    salt: ml(0),
    protein: ml(0),
    fibre: ml(0),
    fvl: { value: 0, unit: 'percent', basis: 'per_100_ml' },
  },
};

function withFacts(
  input: NutriScoreInput,
  facts: Partial<Record<keyof ScoringFactStates, FactState>>,
): NutriScoreInput {
  return { ...input, facts: { ...input.facts, ...facts } };
}

function withNutrient(
  input: NutriScoreInput,
  field: NutriScoreNutrient,
  amount: unknown,
): NutriScoreInput {
  // Cast: adversarial tests pass shapes the type system would reject.
  return {
    ...input,
    nutrients: { ...input.nutrients, [field]: amount },
  } as NutriScoreInput;
}

function issueCodes(result: NutriScoreResult): string[] {
  return result.state === 'graded'
    ? []
    : result.issues.map((issue) => issue.code);
}

function points(
  result: NutriScoreResult,
  component: string,
): number | undefined {
  return result.state === 'graded'
    ? result.trace.find((step) => step.component === component)?.points
    : undefined;
}

describe('pinned method bundle', () => {
  it('loads without problems', () => {
    expect(PINNED_METHOD.ok).toBe(true);
  });

  it('makes the method unavailable instead of scoring a changed bundle', () => {
    const broken = JSON.parse(JSON.stringify(methodJson)) as {
      routes: {
        general: { adverseComponents: { energy: { thresholds: number[] } } };
      };
    };
    broken.routes.general.adverseComponents.energy.thresholds.reverse();
    const loaded = loadMethodBundle(broken, manifestJson);
    expect(loaded.ok).toBe(false);
    expect(calculateWithMethod(loaded, GENERAL).state).toBe(
      'method_unavailable',
    );
  });
});

describe('case 1: route points and letter boundaries', () => {
  if (!PINNED_METHOD.ok) {
    throw new Error('pinned method must load');
  }
  const general = PINNED_METHOD.method.routes.general;

  for (const rule of general.adverse) {
    if (rule.kind !== 'declared') {
      continue;
    }
    const { table, field, component } = rule;
    const unit = field === 'energy' ? 'kJ' : 'g';
    it.each(
      table.thresholdValues.map(
        (value, index) => [component, value, index] as const,
      ),
    )(
      '%s at threshold %d scores by the bundle operator',
      (_name, threshold, index) => {
        const at = calculateNutriScore(
          withNutrient(GENERAL, field, {
            value: threshold,
            unit,
            basis: 'per_100_g',
          }),
        );
        const expectedAt =
          table.operator === '>='
            ? table.points[index + 1]
            : table.points[index];
        expect(points(at, component)).toBe(expectedAt);
        const above = calculateNutriScore(
          withNutrient(GENERAL, field, {
            value: threshold + 0.001,
            unit,
            basis: 'per_100_g',
          }),
        );
        expect(points(above, component)).toBe(table.points[index + 1]);
      },
    );
  }

  it('assigns each graded score the letter whose range contains it', () => {
    const result = calculateNutriScore(GENERAL);
    expect(result.state).toBe('graded');
    if (result.state === 'graded') {
      const { minScore, maxScore } = result.letterBoundary;
      expect(minScore === null || result.score >= minScore).toBe(true);
      expect(maxScore === null || result.score <= maxScore).toBe(true);
    }
  });

  it('refuses an excluded category as unsupported', () => {
    const result = calculateNutriScore({ ...GENERAL, category: 'excluded' });
    expect(result.state).toBe('unsupported');
    expect(issueCodes(result)).toEqual(['excluded_category']);
  });

  it('grades supported plain water by the water rule without nutrients', () => {
    const result = calculateNutriScore({
      category: 'beverage',
      facts: withFacts(DRINK, { plainWater: 'present' }).facts,
      nutrients: {},
    });
    expect(result.state).toBe('graded');
    if (result.state === 'graded') {
      expect(result.letterBoundary.rule).toBe('plain_water');
    }
  });

  it('adds sweetener points only when a sweetener is present', () => {
    const absent = calculateNutriScore(DRINK);
    const present = calculateNutriScore(
      withFacts(DRINK, { nonNutritiveSweetener: 'present' }),
    );
    expect(points(absent, 'sweeteners')).toBe(0);
    expect(points(present, 'sweeteners')).toBeGreaterThan(0);
  });

  it.each([
    ['low protein', GENERAL, 2, 'cannot_bind', true],
    ['protein excluded at high Points A', HIGH_A, 7, 'not_evaluated', false],
  ])(
    'does not apply the red-meat cap for %s',
    (_name, input, expectedPoints, capUse, counted) => {
      const result = calculateNutriScore(
        withFacts(input, { redMeat: 'present' }),
      );
      expect(result.state).toBe('graded');
      if (result.state !== 'graded') throw new Error('Expected graded result');
      const protein = result.trace.find((step) => step.component === 'protein');
      expect(protein).toMatchObject({
        points: expectedPoints,
        counted,
        redMeatCap: capUse,
        ruleLocator:
          methodJson.routes.general.favourableComponents.protein.ruleLocator,
      });
      expect(protein).not.toHaveProperty('uncappedPoints');
      expect(result.facts.redMeat.effect).toBe('no_effect');
    },
  );

  it.each([
    'energy',
    'sugars',
    'saturates',
    'salt',
    'protein',
    'fibre',
    'fat',
    'fvl',
  ] as const)(
    'refuses plain water with nonzero %s even outside the route-required fields',
    (field) => {
      const result = calculateNutriScore({
        category: 'beverage',
        facts: withFacts(DRINK, { plainWater: 'present' }).facts,
        nutrients: {
          [field]:
            field === 'fvl'
              ? { value: 1, unit: 'percent', basis: 'per_100_ml' }
              : ml(1, field === 'energy' ? 'kJ' : 'g'),
        },
      });
      expect(result.state).toBe('insufficient_data');
      expect(issueCodes(result)).toEqual(['conflicting_water_facts']);
    },
  );
});

describe('case 2: refuse missing, unsupported or ambiguous data', () => {
  it.each([
    'energy',
    'sugars',
    'saturates',
    'salt',
    'protein',
    'fibre',
    'fvl',
  ] as const)('names missing %s instead of reading it as zero', (field) => {
    const nutrients = { ...GENERAL.nutrients };
    delete nutrients[field];
    const result = calculateNutriScore({ ...GENERAL, nutrients });
    expect(result.state).toBe('insufficient_data');
    expect(issueCodes(result)).toEqual([`missing_${field}`]);
  });

  it('lists every missing field, not only the first', () => {
    const result = calculateNutriScore({ ...GENERAL, nutrients: {} });
    expect(issueCodes(result)).toHaveLength(7);
  });

  it.each([
    ['negative', { value: -1, unit: 'g', basis: 'per_100_g' }, 'invalid_value'],
    [
      'NaN',
      { value: Number.NaN, unit: 'g', basis: 'per_100_g' },
      'invalid_value',
    ],
    [
      'Infinity',
      { value: Number.POSITIVE_INFINITY, unit: 'g', basis: 'per_100_g' },
      'invalid_value',
    ],
    ['text', { value: '4', unit: 'g', basis: 'per_100_g' }, 'invalid_value'],
    [
      'milligrams',
      { value: 4000, unit: 'mg', basis: 'per_100_g' },
      'unsupported_unit',
    ],
    [
      'per serving',
      { value: 4, unit: 'g', basis: 'per_serving' },
      'unsupported_basis',
    ],
    [
      'per 100 ml on a food',
      { value: 4, unit: 'g', basis: 'per_100_ml' },
      'unsupported_basis',
    ],
    [
      'over 100 g',
      { value: 120, unit: 'g', basis: 'per_100_g' },
      'out_of_range',
    ],
  ])('refuses %s sugars', (_name, amount, code) => {
    const result = calculateNutriScore(withNutrient(GENERAL, 'sugars', amount));
    expect(result.state).toBe('insufficient_data');
    expect(issueCodes(result)).toEqual([code]);
  });

  it('refuses an unknown category', () => {
    expect(
      issueCodes(calculateNutriScore({ ...GENERAL, category: 'unknown' })),
    ).toEqual(['unsupported_category']);
  });

  it('treats an omitted fact as unknown, never absent', () => {
    const result = calculateNutriScore({
      ...DRINK,
      facts: {
        cheese: 'absent',
        redMeat: 'absent',
        nonNutritiveSweetener: 'absent',
      },
    } as unknown as NutriScoreInput);
    expect(issueCodes(result)).toEqual(['plain_water_unknown']);
  });

  it('refuses when cheese is unknown and decides whether protein counts', () => {
    const result = calculateNutriScore(
      withFacts(HIGH_A, { cheese: 'unknown' }),
    );
    expect(issueCodes(result)).toEqual(['cheese_unknown']);
  });

  it('grades when cheese is unknown but cannot change the score', () => {
    const result = calculateNutriScore(
      withFacts(GENERAL, { cheese: 'unknown' }),
    );
    expect(result.state).toBe('graded');
    if (result.state === 'graded') {
      expect(result.facts.cheese.effect).toBe('no_effect');
    }
  });

  it('refuses when red meat is unknown and the cap would bind', () => {
    const lowA = withNutrient(GENERAL, 'protein', g(20));
    const result = calculateNutriScore(withFacts(lowA, { redMeat: 'unknown' }));
    expect(issueCodes(result)).toEqual(['red_meat_unknown']);
  });

  it('refuses an invalid fact value', () => {
    const result = calculateNutriScore({
      ...GENERAL,
      facts: { ...KNOWN, cheese: true },
    } as unknown as NutriScoreInput);
    expect(issueCodes(result)).toEqual(['invalid_fact']);
  });

  const contradictions: [
    string,
    'general' | 'beverage',
    Partial<Record<keyof ScoringFactStates, FactState>>,
  ][] = [
    [
      'cheese and red meat',
      'general',
      { cheese: 'present', redMeat: 'present' },
    ],
    [
      'plain water with sweetener',
      'beverage',
      { plainWater: 'present', nonNutritiveSweetener: 'present' },
    ],
    ['plain water on a food', 'general', { plainWater: 'present' }],
    ['cheese on a drink', 'beverage', { cheese: 'present' }],
  ];
  it.each(contradictions)(
    'refuses contradictory facts: %s',
    (_name, category, facts) => {
      const base = category === 'general' ? GENERAL : DRINK;
      const result = calculateNutriScore(withFacts(base, facts));
      expect(issueCodes(result)).toContain('contradictory_facts');
    },
  );

  it('refuses saturated fat above total fat on the fats route', () => {
    const result = calculateNutriScore({
      ...GENERAL,
      category: 'fats_nuts_seeds',
      nutrients: { ...GENERAL.nutrients, saturates: g(20), fat: g(10) },
    });
    expect(issueCodes(result)).toEqual(['saturates_exceed_fat']);
  });

  it('refuses a zero total fat on the fats route', () => {
    const result = calculateNutriScore({
      ...GENERAL,
      category: 'fats_nuts_seeds',
      nutrients: { ...GENERAL.nutrients, saturates: g(0), fat: g(0) },
    });
    expect(issueCodes(result)).toEqual(['saturates_ratio_undefined']);
  });
});

describe('case 3: deterministic trace independent of personal settings', () => {
  it('returns identical output for identical input', () => {
    expect(calculateNutriScore(HIGH_A)).toEqual(calculateNutriScore(HIGH_A));
  });

  it('does not mutate a frozen input', () => {
    const frozen = JSON.parse(JSON.stringify(GENERAL)) as NutriScoreInput;
    Object.freeze(frozen);
    Object.freeze(frozen.nutrients);
    Object.freeze(frozen.facts);
    expect(() => calculateNutriScore(frozen)).not.toThrow();
  });

  it('ignores profile-like fields even when a caller adds them', () => {
    const withProfile = {
      ...GENERAL,
      profile: { allergies: ['peanut'], diet: 'vegan', avoidSugar: true },
    } as unknown as NutriScoreInput;
    expect(calculateNutriScore(withProfile)).toEqual(
      calculateNutriScore(GENERAL),
    );
  });

  it('ignores inherited properties on the input', () => {
    const inherited = Object.create({
      category: 'excluded',
    }) as NutriScoreInput;
    expect(calculateNutriScore(inherited).state).toBe('insufficient_data');
  });

  it('traces every component with a rule locator and citation', () => {
    const result = calculateNutriScore(GENERAL);
    expect(result.state).toBe('graded');
    if (result.state === 'graded') {
      for (const step of result.trace) {
        expect(step.ruleLocator.length).toBeGreaterThan(0);
        expect(step.citationIds.length).toBeGreaterThan(0);
      }
    }
  });
});
