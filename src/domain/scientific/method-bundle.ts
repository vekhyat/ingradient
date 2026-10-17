import manifestJson from '../../../resources/manifest.json';
import methodJson from '../../../resources/method/nutriscore-updated-2023.json';
import type { Decimal } from '../nutrition/decimal';
import { decimalFromNumber } from './exact-decimal';
import type {
  MethodIdentity,
  NutrientUnit,
  NutriScoreLetter,
  NutriScoreNutrient,
  NutriScoreRoute,
  TraceComponent,
} from './types';

/**
 * Reads the pinned method bundle (resources/method/nutriscore-updated-2023.json,
 * hash in resources/manifest.json) into checked rules.
 *
 * Thresholds, point scales, conditional-protein limits, the red-meat cap,
 * the sweetener points, score bounds and letter ranges all come from the
 * resource. This file only fixes which components each route has, so a
 * resource that adds, drops or rewrites a component makes the method
 * unavailable instead of being scored with half-understood rules.
 */

export type Basis100 = 'per_100_g' | 'per_100_ml';

export interface PointsTable {
  readonly thresholds: readonly Decimal[];
  readonly thresholdValues: readonly number[];
  /** `>` counts thresholds strictly exceeded; `>=` counts thresholds met. */
  readonly operator: '>' | '>=';
  /** points[k] is awarded when k thresholds count. */
  readonly points: readonly number[];
  readonly unit: NutrientUnit;
  readonly basis: Basis100;
  readonly ruleLocator: string;
}

export type AdverseRule =
  | {
      readonly kind: 'declared';
      readonly component: TraceComponent;
      readonly field: NutriScoreNutrient;
      readonly table: PointsTable;
    }
  | {
      readonly kind: 'energy_from_saturates';
      readonly component: 'energy_from_saturates';
      readonly factorKjPerGram: Decimal;
      readonly factorText: string;
      readonly table: PointsTable;
    }
  | {
      readonly kind: 'saturates_ratio';
      readonly component: 'saturates_ratio';
      readonly table: PointsTable;
    }
  | {
      readonly kind: 'sweetener_presence';
      readonly component: 'sweeteners';
      readonly pointsIfPresent: number;
      readonly pointsIfAbsent: number;
      readonly ruleLocator: string;
    };

export interface FavourableRule {
  readonly component: 'protein' | 'fibres' | 'fvl';
  readonly field: NutriScoreNutrient;
  readonly table: PointsTable;
  readonly redMeatCap: {
    readonly maxPoints: number;
    readonly ruleLocator: string;
  } | null;
}

export type ProteinRule =
  | {
      readonly kind: 'conditional';
      /** Protein counts when Points A is below this (or for cheese, if allowed). */
      readonly pointsAThreshold: number;
      readonly cheeseException: boolean;
      readonly ruleLocator: string;
    }
  | { readonly kind: 'always'; readonly ruleLocator: string };

export interface LetterRange {
  readonly letter: NutriScoreLetter;
  readonly minScore: number | null;
  readonly maxScore: number | null;
}

export interface RouteMethod {
  readonly route: NutriScoreRoute;
  readonly basis: Basis100;
  readonly citationIds: readonly string[];
  readonly adverse: readonly AdverseRule[];
  readonly favourable: readonly FavourableRule[];
  readonly proteinRule: ProteinRule;
  readonly scoreBounds: { readonly min: number; readonly max: number };
  readonly letters: readonly LetterRange[];
  /** Letter for supported plain water, or null when the route has no water rule. */
  readonly waterLetter: NutriScoreLetter | null;
  readonly scoringRuleLocator: string;
}

export interface MethodBundle {
  readonly identity: MethodIdentity;
  readonly routes: Readonly<Record<NutriScoreRoute, RouteMethod>>;
}

export type LoadedMethod =
  | { readonly ok: true; readonly method: MethodBundle }
  | { readonly ok: false; readonly problems: readonly string[] };

const LETTERS: readonly NutriScoreLetter[] = ['A', 'B', 'C', 'D', 'E'];

/**
 * The calculation tool is cited alongside each report because every
 * ruleLocator in the resource names both a report page and a calculator sheet.
 */
const CALCULATOR_CITATION = 'fps-public-health-tool-2025';
const ROUTE_REPORT_CITATION: Readonly<Record<NutriScoreRoute, string>> = {
  general: 'sc-food-2022',
  fats_nuts_seeds: 'sc-food-2022',
  beverage: 'sc-beverage-2023',
};

interface AdverseSpec {
  readonly key: string;
  readonly kind: AdverseRule['kind'];
  readonly component: TraceComponent;
  readonly field: NutriScoreNutrient | null;
  readonly unit: NutrientUnit | null;
}

interface RouteSpec {
  readonly adverse: readonly AdverseSpec[];
  readonly proteinRule: 'conditional_with_cheese' | 'conditional' | 'always';
  readonly redMeatCap: boolean;
  readonly water: boolean;
}

const FAVOURABLE_SPEC: readonly {
  key: 'protein' | 'fibres' | 'fvl';
  field: NutriScoreNutrient;
  unit: NutrientUnit;
}[] = [
  { key: 'protein', field: 'protein', unit: 'g' },
  { key: 'fibres', field: 'fibre', unit: 'g' },
  { key: 'fvl', field: 'fvl', unit: 'percent' },
];

const declared = (
  key: 'energy' | 'sugars' | 'saturates' | 'salt',
  field: NutriScoreNutrient,
  unit: NutrientUnit,
): AdverseSpec => ({ key, kind: 'declared', component: key, field, unit });

const ROUTE_SPECS: Readonly<Record<NutriScoreRoute, RouteSpec>> = {
  general: {
    adverse: [
      declared('energy', 'energy', 'kJ'),
      declared('sugars', 'sugars', 'g'),
      declared('saturates', 'saturates', 'g'),
      declared('salt', 'salt', 'g'),
    ],
    proteinRule: 'conditional_with_cheese',
    redMeatCap: true,
    water: false,
  },
  fats_nuts_seeds: {
    adverse: [
      {
        key: 'energy',
        kind: 'energy_from_saturates',
        component: 'energy_from_saturates',
        field: null,
        unit: 'kJ',
      },
      declared('sugars', 'sugars', 'g'),
      {
        key: 'saturates',
        kind: 'saturates_ratio',
        component: 'saturates_ratio',
        field: null,
        unit: 'percent',
      },
      declared('salt', 'salt', 'g'),
    ],
    proteinRule: 'conditional',
    redMeatCap: false,
    water: false,
  },
  beverage: {
    adverse: [
      declared('energy', 'energy', 'kJ'),
      declared('sugars', 'sugars', 'g'),
      declared('saturates', 'saturates', 'g'),
      declared('salt', 'salt', 'g'),
      {
        key: 'sweeteners',
        kind: 'sweetener_presence',
        component: 'sweeteners',
        field: null,
        unit: null,
      },
    ],
    proteinRule: 'always',
    redMeatCap: false,
    water: true,
  },
};

const ENERGY_FROM_SATURATES = /^saturates_g \* (\d+)$/;
const SATURATES_RATIO = '(saturates_g / total_fat_g) * 100';

export function loadMethodBundle(
  rawMethod: unknown,
  rawManifest: unknown,
): LoadedMethod {
  const problems: string[] = [];
  const reader = new Reader(problems);
  const root = reader.object(rawMethod, 'method');
  const identity = readIdentity(reader, root, rawManifest);
  const citationIds = new Set(
    reader
      .array(root?.citations, 'citations')
      .map((entry, index) =>
        reader.string(reader.object(entry, `citations[${index}]`)?.id, 'id'),
      ),
  );
  const routesRoot = reader.object(root?.routes, 'routes');
  const routes: Partial<Record<NutriScoreRoute, RouteMethod>> = {};
  for (const route of Object.keys(ROUTE_SPECS) as NutriScoreRoute[]) {
    const citations = [ROUTE_REPORT_CITATION[route], CALCULATOR_CITATION];
    for (const id of citations) {
      if (!citationIds.has(id)) {
        problems.push(`citation ${id} is missing`);
      }
    }
    const parsed = readRoute(
      reader,
      route,
      routesRoot?.[route],
      citations,
      ROUTE_SPECS[route],
    );
    if (parsed !== null) {
      routes[route] = parsed;
    }
  }
  const { general, fats_nuts_seeds: fats, beverage } = routes;
  if (
    problems.length > 0 ||
    identity === null ||
    general === undefined ||
    fats === undefined ||
    beverage === undefined
  ) {
    return {
      ok: false,
      problems: problems.length > 0 ? problems : ['invalid'],
    };
  }
  return {
    ok: true,
    method: {
      identity,
      routes: { general, fats_nuts_seeds: fats, beverage },
    },
  };
}

function readIdentity(
  reader: Reader,
  root: Record<string, unknown> | null,
  rawManifest: unknown,
): MethodIdentity | null {
  const id = reader.string(root?.id, 'id');
  const edition = reader.string(root?.edition, 'edition');
  const label = reader.string(root?.label, 'label');
  const bundles = reader.array(
    reader.object(rawManifest, 'manifest')?.bundles,
    'manifest.bundles',
  );
  const entry = bundles
    .map((bundle) => reader.object(bundle, 'manifest.bundles[]'))
    .find((bundle) => bundle?.bundleId === id);
  if (entry === undefined || entry === null) {
    reader.problems.push(`manifest has no bundle ${id}`);
    return null;
  }
  const sha = reader.string(entry.sha256, 'manifest sha256');
  if (!/^[0-9a-f]{64}$/.test(sha)) {
    reader.problems.push('manifest sha256 is not 64 lowercase hex digits');
  }
  return { id, edition, bundleId: id, bundleSha256: sha, label };
}

function readRoute(
  reader: Reader,
  route: NutriScoreRoute,
  raw: unknown,
  citationIds: readonly string[],
  spec: RouteSpec,
): RouteMethod | null {
  const before = reader.problems.length;
  const root = reader.object(raw, route);
  const adverseRoot = reader.object(
    root?.adverseComponents,
    `${route}.adverseComponents`,
  );
  const favourableRoot = reader.object(
    root?.favourableComponents,
    `${route}.favourableComponents`,
  );
  reader.sameKeys(
    adverseRoot,
    spec.adverse.map((entry) => entry.key),
    `${route}.adverseComponents`,
  );
  reader.sameKeys(
    favourableRoot,
    FAVOURABLE_SPEC.map((entry) => entry.key),
    `${route}.favourableComponents`,
  );

  const adverse: AdverseRule[] = [];
  for (const entry of spec.adverse) {
    const path = `${route}.${entry.key}`;
    const component = reader.object(adverseRoot?.[entry.key], path);
    const rule = readAdverse(reader, entry, component, path);
    if (rule !== null) {
      adverse.push(rule);
    }
  }

  const favourable: FavourableRule[] = [];
  for (const entry of FAVOURABLE_SPEC) {
    const path = `${route}.${entry.key}`;
    const component = reader.object(favourableRoot?.[entry.key], path);
    const table = readTable(reader, component, path, entry.unit);
    const exceptions = component?.exceptions;
    let redMeatCap: FavourableRule['redMeatCap'] = null;
    if (entry.key === 'protein' && spec.redMeatCap) {
      const cap = reader.object(
        reader.object(exceptions, `${path}.exceptions`)?.red_meat,
        `${path}.exceptions.red_meat`,
      );
      redMeatCap = {
        maxPoints: reader.integer(cap?.maxPoints, `${path} red-meat maxPoints`),
        ruleLocator: reader.string(
          cap?.ruleLocator,
          `${path} red-meat locator`,
        ),
      };
    } else if (exceptions !== undefined) {
      reader.problems.push(`${path}.exceptions is not understood`);
    }
    if (table !== null) {
      favourable.push({
        component: entry.key,
        field: entry.field,
        table,
        redMeatCap,
      });
    }
  }

  const scoring = reader.object(root?.scoring, `${route}.scoring`);
  const proteinRule = readProteinRule(reader, scoring, spec, route);
  const bounds = reader.object(scoring?.scoreBounds, `${route}.scoreBounds`);
  const scoreBounds = {
    min: reader.integer(bounds?.min, `${route} score min`),
    max: reader.integer(bounds?.max, `${route} score max`),
  };
  const scoringRuleLocator = reader.string(
    scoring?.ruleLocator,
    `${route}.scoring.ruleLocator`,
  );
  const { letters, waterLetter } = readLetters(
    reader,
    scoring?.letterMapping,
    route,
    spec.water,
  );
  if (spec.water) {
    reader.string(scoring?.waterRule, `${route}.scoring.waterRule`);
  }

  const basis = commonBasis(reader, adverse, favourable, route);
  checkSums(reader, scoring, adverse, favourable, scoreBounds, route);
  checkLetterCoverage(reader, letters, scoreBounds, route);
  if (reader.problems.length > before || basis === null) {
    return null;
  }
  return {
    route,
    basis,
    citationIds,
    adverse,
    favourable,
    proteinRule,
    scoreBounds,
    letters,
    waterLetter,
    scoringRuleLocator,
  };
}

function readAdverse(
  reader: Reader,
  spec: AdverseSpec,
  component: Record<string, unknown> | null,
  path: string,
): AdverseRule | null {
  if (spec.kind === 'sweetener_presence') {
    if (component?.basis !== 'presence_or_absence') {
      reader.problems.push(`${path}.basis must be presence_or_absence`);
    }
    return {
      kind: 'sweetener_presence',
      component: 'sweeteners',
      pointsIfPresent: reader.integer(
        component?.pointsIfPresent,
        `${path}.pointsIfPresent`,
      ),
      pointsIfAbsent: reader.integer(
        component?.pointsIfAbsent,
        `${path}.pointsIfAbsent`,
      ),
      ruleLocator: reader.string(component?.ruleLocator, `${path}.ruleLocator`),
    };
  }
  const table = readTable(reader, component, path, spec.unit);
  const calculation = component?.calculation;
  if (spec.kind === 'declared') {
    if (calculation !== undefined) {
      reader.problems.push(`${path}.calculation is not understood`);
    }
    return table === null || spec.field === null
      ? null
      : {
          kind: 'declared',
          component: spec.component,
          field: spec.field,
          table,
        };
  }
  if (spec.kind === 'energy_from_saturates') {
    const match =
      typeof calculation === 'string'
        ? ENERGY_FROM_SATURATES.exec(calculation)
        : null;
    const factor = match === null ? null : decimalFromNumber(Number(match[1]));
    if (factor === null) {
      reader.problems.push(`${path}.calculation must be "saturates_g * N"`);
      return null;
    }
    return table === null
      ? null
      : {
          kind: 'energy_from_saturates',
          component: 'energy_from_saturates',
          factorKjPerGram: factor,
          factorText: match?.[1] ?? '',
          table,
        };
  }
  if (calculation !== SATURATES_RATIO) {
    reader.problems.push(`${path}.calculation must be "${SATURATES_RATIO}"`);
    return null;
  }
  return table === null
    ? null
    : { kind: 'saturates_ratio', component: 'saturates_ratio', table };
}

function readTable(
  reader: Reader,
  component: Record<string, unknown> | null,
  path: string,
  expectedUnit: NutrientUnit | null,
): PointsTable | null {
  const before = reader.problems.length;
  const thresholdValues = reader
    .array(component?.thresholds, `${path}.thresholds`)
    .map((value, index) =>
      reader.number(value, `${path}.thresholds[${index}]`),
    );
  const thresholds = thresholdValues.map((value) => decimalFromNumber(value));
  const points = reader
    .array(component?.points, `${path}.points`)
    .map((value, index) => reader.integer(value, `${path}.points[${index}]`));
  const operator = readOperator(reader, component?.operator, path);
  const unit = component?.unit;
  const basis = component?.basis;
  const ruleLocator = reader.string(
    component?.ruleLocator,
    `${path}.ruleLocator`,
  );
  if (thresholds.some((value) => value === null) || thresholds.length === 0) {
    reader.problems.push(`${path}.thresholds must be non-negative numbers`);
  }
  for (let index = 1; index < thresholdValues.length; index += 1) {
    if ((thresholdValues[index] ?? 0) <= (thresholdValues[index - 1] ?? 0)) {
      reader.problems.push(`${path}.thresholds must increase`);
    }
  }
  if (points.length !== thresholdValues.length + 1 || points[0] !== 0) {
    reader.problems.push(`${path}.points must start at 0, one per band`);
  }
  for (let index = 1; index < points.length; index += 1) {
    if ((points[index] ?? 0) < (points[index - 1] ?? 0)) {
      reader.problems.push(`${path}.points must not decrease`);
    }
  }
  if (unit !== expectedUnit) {
    reader.problems.push(`${path}.unit must be ${String(expectedUnit)}`);
  }
  if (basis !== 'per_100_g' && basis !== 'per_100_ml') {
    reader.problems.push(`${path}.basis must be per_100_g or per_100_ml`);
  }
  if (
    reader.problems.length > before ||
    operator === null ||
    expectedUnit === null ||
    (basis !== 'per_100_g' && basis !== 'per_100_ml')
  ) {
    return null;
  }
  return {
    thresholds: thresholds.filter((value): value is Decimal => value !== null),
    thresholdValues,
    operator,
    points,
    unit: expectedUnit,
    basis,
    ruleLocator,
  };
}

/**
 * The resource writes beverage energy and sugars as "<=" bands
 * ("<= 30 -> 0; <= 90 -> 1; ...; > 390 -> 10"). A value scores the band of
 * the first threshold it does not exceed, which is the same as counting the
 * thresholds it strictly exceeds, so "<=" and ">" read identically.
 */
function readOperator(
  reader: Reader,
  raw: unknown,
  path: string,
): '>' | '>=' | null {
  if (raw === '>' || raw === '<=') {
    return '>';
  }
  if (raw === '>=') {
    return '>=';
  }
  reader.problems.push(`${path}.operator is not understood`);
  return null;
}

function readProteinRule(
  reader: Reader,
  scoring: Record<string, unknown> | null,
  spec: RouteSpec,
  route: NutriScoreRoute,
): ProteinRule {
  const rule = scoring?.conditionalProteinRule;
  if (spec.proteinRule === 'always') {
    if (rule !== undefined) {
      reader.problems.push(`${route}: unexpected conditionalProteinRule`);
    }
    reader.string(scoring?.scoreFormula, `${route}.scoring.scoreFormula`);
    return {
      kind: 'always',
      ruleLocator: reader.string(scoring?.ruleLocator, `${route} locator`),
    };
  }
  const conditional = reader.object(rule, `${route}.conditionalProteinRule`);
  const condition = reader.string(conditional?.condition, `${route} condition`);
  const cheeseException = spec.proteinRule === 'conditional_with_cheese';
  // The cheese exception is only described in prose; refuse if the prose and
  // this route's expectation disagree.
  if (condition.includes("category == 'cheese'") !== cheeseException) {
    reader.problems.push(`${route}: cheese exception wording changed`);
  }
  return {
    kind: 'conditional',
    pointsAThreshold: reader.integer(
      conditional?.thresholdA,
      `${route} thresholdA`,
    ),
    cheeseException,
    ruleLocator: reader.string(conditional?.ruleLocator, `${route} locator`),
  };
}

function readLetters(
  reader: Reader,
  raw: unknown,
  route: NutriScoreRoute,
  allowWater: boolean,
): { letters: LetterRange[]; waterLetter: NutriScoreLetter | null } {
  const letters: LetterRange[] = [];
  let waterLetter: NutriScoreLetter | null = null;
  const entries = reader.array(raw, `${route}.letterMapping`);
  for (const [index, value] of entries.entries()) {
    const path = `${route}.letterMapping[${index}]`;
    const entry = reader.object(value, path);
    const letter = entry?.letter;
    if (entry === null || !isLetter(letter)) {
      reader.problems.push(`${path}.letter is not A-E`);
      continue;
    }
    if (entry.special !== undefined) {
      if (entry.special !== 'water' || !allowWater || waterLetter !== null) {
        reader.problems.push(`${path}.special is not understood`);
      }
      waterLetter = letter;
      continue;
    }
    letters.push({
      letter,
      minScore:
        entry.minScore === undefined
          ? null
          : reader.integer(entry.minScore, `${path}.minScore`),
      maxScore:
        entry.maxScore === undefined
          ? null
          : reader.integer(entry.maxScore, `${path}.maxScore`),
    });
  }
  if (allowWater && waterLetter === null) {
    reader.problems.push(`${route}: water letter is missing`);
  }
  return { letters, waterLetter };
}

function commonBasis(
  reader: Reader,
  adverse: readonly AdverseRule[],
  favourable: readonly FavourableRule[],
  route: NutriScoreRoute,
): Basis100 | null {
  const bases = new Set<Basis100>();
  for (const rule of adverse) {
    if (rule.kind !== 'sweetener_presence') {
      bases.add(rule.table.basis);
    }
  }
  for (const rule of favourable) {
    bases.add(rule.table.basis);
  }
  const [basis, ...others] = [...bases];
  if (basis === undefined || others.length > 0) {
    reader.problems.push(`${route}: components must share one basis`);
    return null;
  }
  return basis;
}

function checkSums(
  reader: Reader,
  scoring: Record<string, unknown> | null,
  adverse: readonly AdverseRule[],
  favourable: readonly FavourableRule[],
  bounds: { min: number; max: number },
  route: NutriScoreRoute,
): void {
  const adverseMax = adverse.reduce(
    (sum, rule) =>
      sum +
      (rule.kind === 'sweetener_presence'
        ? Math.max(rule.pointsIfPresent, rule.pointsIfAbsent)
        : maxPoints(rule.table)),
    0,
  );
  const favourableMax = favourable.reduce(
    (sum, rule) => sum + maxPoints(rule.table),
    0,
  );
  if (
    scoring?.adverseSumMax !== adverseMax ||
    scoring?.favourableSumMax !== favourableMax ||
    bounds.max !== adverseMax ||
    bounds.min !== -favourableMax
  ) {
    reader.problems.push(`${route}: point sums and score bounds disagree`);
  }
}

/** Every integer score in the route bounds must fall in exactly one letter. */
function checkLetterCoverage(
  reader: Reader,
  letters: readonly LetterRange[],
  bounds: { min: number; max: number },
  route: NutriScoreRoute,
): void {
  for (let score = bounds.min; score <= bounds.max; score += 1) {
    const matches = letters.filter((range) => inRange(range, score)).length;
    if (matches !== 1) {
      reader.problems.push(
        `${route}: score ${score} matches ${matches} letters`,
      );
      return;
    }
  }
}

function isLetter(value: unknown): value is NutriScoreLetter {
  return LETTERS.some((letter) => letter === value);
}

export function inRange(range: LetterRange, score: number): boolean {
  return (
    (range.minScore === null || score >= range.minScore) &&
    (range.maxScore === null || score <= range.maxScore)
  );
}

export function maxPoints(table: PointsTable): number {
  return table.points[table.points.length - 1] ?? 0;
}

/** Collects every structural problem instead of stopping at the first. */
class Reader {
  constructor(readonly problems: string[]) {}

  object(value: unknown, path: string): Record<string, unknown> | null {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    this.problems.push(`${path} must be an object`);
    return null;
  }

  array(value: unknown, path: string): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    this.problems.push(`${path} must be an array`);
    return [];
  }

  string(value: unknown, path: string): string {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
    this.problems.push(`${path} must be a non-empty string`);
    return '';
  }

  number(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
    this.problems.push(`${path} must be a non-negative number`);
    return Number.NaN;
  }

  integer(value: unknown, path: string): number {
    if (typeof value === 'number' && Number.isInteger(value)) {
      return value;
    }
    this.problems.push(`${path} must be an integer`);
    return 0;
  }

  sameKeys(
    value: Record<string, unknown> | null,
    expected: readonly string[],
    path: string,
  ): void {
    if (value === null) {
      return;
    }
    const actual = Object.keys(value).sort();
    const wanted = [...expected].sort();
    if (actual.join(',') !== wanted.join(',')) {
      this.problems.push(`${path} must be exactly ${wanted.join(', ')}`);
    }
  }
}

/**
 * The bundle shipped with the app, checked once at module load. Declared
 * last because it runs `Reader`, which a class declaration hoists only after
 * its definition.
 */
export const PINNED_METHOD: LoadedMethod = loadMethodBundle(
  methodJson,
  manifestJson,
);
