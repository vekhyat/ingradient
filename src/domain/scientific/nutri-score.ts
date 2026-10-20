import type { Decimal } from '../nutrition/decimal';
import {
  compareDecimals,
  decimalFromNumber,
  decimalText,
  divideForDisplay,
  multiplyDecimals,
} from './exact-decimal';
import {
  PINNED_METHOD,
  inRange,
  maxPoints,
  type AdverseRule,
  type FavourableRule,
  type LoadedMethod,
  type MethodBundle,
  type PointsTable,
  type RouteMethod,
} from './method-bundle';
import type {
  CalculationIssue,
  ComponentEvaluation,
  FactState,
  FactUse,
  GradedResult,
  MethodIdentity,
  NutrientUnit,
  NutriScoreInput,
  NutriScoreNutrient,
  NutriScoreResult,
  NutriScoreRoute,
  RedMeatCapUse,
  RefusedResult,
  ScoringFactName,
  TraceStep,
} from './types';

/**
 * Nutri-Score updated-algorithm reference calculation (SCI-01).
 *
 * Pure and deterministic: the same input always gives the same result, with
 * no clock, randomness, I/O or logging. The only input is product data.
 * Rules come from the pinned bundle; every trace step carries the bundle's
 * rule locator and citations.
 *
 * A letter is produced only when every fact the method needs for this input
 * is known. A missing nutrient is never read as zero. An unknown exception
 * fact is accepted only when the method's own rules make it irrelevant for
 * this input, in which case `facts` records why; otherwise the result is a
 * refusal that names what is missing.
 */
export function calculateNutriScore(input: NutriScoreInput): NutriScoreResult {
  return calculateWithMethod(PINNED_METHOD, input);
}

/** Same calculation with an explicit bundle, so tests can supply broken ones. */
export function calculateWithMethod(
  loaded: LoadedMethod,
  input: NutriScoreInput,
): NutriScoreResult {
  if (!loaded.ok) {
    return refuse('method_unavailable', null, null, ISSUES.methodUnavailable);
  }
  const { method } = loaded;
  const category = ownField(input, 'category');
  if (category === 'excluded') {
    return refuse('unsupported', null, method.identity, ISSUES.excluded);
  }
  if (!isRoute(category)) {
    return refuse(
      'insufficient_data',
      null,
      method.identity,
      ISSUES.unsupportedCategory,
    );
  }
  return calculateRoute(method, method.routes[category], input);
}

const ROUTES: readonly NutriScoreRoute[] = [
  'general',
  'fats_nuts_seeds',
  'beverage',
];
const FACT_NAMES: readonly ScoringFactName[] = [
  'cheese',
  'redMeat',
  'plainWater',
  'nonNutritiveSweetener',
];

const FIELD_LABELS: Readonly<Record<NutriScoreNutrient, string>> = {
  energy: 'Energy',
  sugars: 'Total sugars',
  saturates: 'Saturated fat',
  salt: 'Salt',
  protein: 'Protein',
  fibre: 'Fibre',
  fat: 'Total fat',
  fvl: 'Fruit, vegetable and legume content',
};

/** Units of `inputFields` in resources/method/nutriscore-updated-2023.json. */
const FIELD_UNITS: Readonly<Record<NutriScoreNutrient, NutrientUnit>> = {
  energy: 'kJ',
  sugars: 'g',
  saturates: 'g',
  salt: 'g',
  protein: 'g',
  fibre: 'g',
  fat: 'g',
  fvl: 'percent',
};

const FACT_LABELS: Readonly<Record<ScoringFactName, string>> = {
  cheese: 'cheese',
  redMeat: 'red meat',
  plainWater: 'plain water',
  nonNutritiveSweetener: 'non-nutritive sweetener',
};

/**
 * Plausibility guards against misread values, not nutrition thresholds.
 * One component cannot exceed the 100 g (or, for drinks, 100 ml) it is part
 * of, and a share cannot exceed 100 %. The densest energy source is fat:
 * 37 kJ/g in Regulation (EU) No 1169/2011 Annex XIV, or 37.66 kJ/g when a
 * label's 9 kcal/g is converted at 4.184 kJ/kcal (FAO Food and Nutrition
 * Paper 77, chapter 3). 3800 kJ per 100 leaves margin above both.
 * https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32011R1169
 * https://www.fao.org/4/y5022e/y5022e04.htm
 */
const UPPER_LIMIT: Readonly<Record<NutrientUnit, number>> = {
  g: 100,
  percent: 100,
  kJ: 3800,
};

const ISSUES = {
  methodUnavailable: {
    code: 'method_unavailable',
    stage: 'method',
    message:
      'The pinned Nutri-Score method bundle could not be read, so no grade is calculated.',
    action: 'none',
  },
  excluded: {
    code: 'excluded_category',
    stage: 'method',
    field: 'category',
    message:
      'This product category is excluded from the Nutri-Score calculation.',
    action: 'none',
  },
  unsupportedCategory: {
    code: 'unsupported_category',
    stage: 'method',
    field: 'category',
    message: 'Product category is not supported for Nutri-Score calculation.',
    action: 'read_source',
  },
} as const satisfies Record<string, CalculationIssue>;

interface ResolvedFact {
  readonly state: FactState;
  /** State used by the rules; an excluded unknown fact resolves to absent. */
  readonly resolved: FactState;
  /** Why an unknown fact resolved to absent, or why the route ignores it. */
  readonly notApplicable: string | null;
}

type ResolvedFacts = Readonly<Record<ScoringFactName, ResolvedFact>>;

function calculateRoute(
  method: MethodBundle,
  rules: RouteMethod,
  input: NutriScoreInput,
): NutriScoreResult {
  const identity = method.identity;
  const route = rules.route;
  const read = readFacts(input);
  const factIssues = [...read.issues, ...contradictions(route, read.states)];
  if (factIssues.length > 0) {
    return refuseAll('insufficient_data', route, identity, factIssues);
  }
  const facts = resolveFacts(route, read.states);

  if (route === 'beverage' && facts.plainWater.resolved === 'present') {
    const nutrients = ownField(input, 'nutrients');
    if (
      Object.keys(FIELD_UNITS).some((field) => {
        const amount = ownField(nutrients, field);
        return amount !== undefined && ownField(amount, 'value') !== 0;
      })
    ) {
      return refuse('insufficient_data', route, identity, {
        code: 'conflicting_water_facts',
        stage: 'completeness',
        field: 'plainWater',
        message: 'Plain-water evidence conflicts with nutrient observations.',
        action: 'add_field',
      });
    }
    return gradeWater(identity, rules, facts);
  }

  const { values, issues } = readNutrients(input, rules);
  if (route === 'beverage') {
    if (facts.plainWater.resolved === 'unknown') {
      issues.push(factUnknown('plain_water_unknown', 'plainWater'));
    }
    if (facts.nonNutritiveSweetener.resolved === 'unknown') {
      issues.push({
        code: 'sweetener_presence_unknown',
        stage: 'completeness',
        field: 'nonNutritiveSweetener',
        message:
          'Sweetener presence is unknown; cannot determine beverage adverse points under updated 2023 algorithm.',
        action: 'add_field',
      });
    }
  }
  if (issues.length > 0) {
    return refuseAll('insufficient_data', route, identity, issues);
  }

  const trace: TraceStep[] = [];
  let pointsA = 0;
  for (const rule of rules.adverse) {
    const step = adverseStep(rule, values, facts, rules);
    pointsA += step.points;
    trace.push(step);
  }
  trace.push({
    component: 'points_a',
    inputFields: rules.adverse.map((rule) => rule.component),
    points: pointsA,
    ruleLocator: rules.proteinRule.ruleLocator,
    citationIds: rules.citationIds,
    note: 'Sum of the adverse component points.',
  });

  const favourable = rules.favourable.map((rule) => ({
    rule,
    scored: scoreTable(rule.table, plainQuantity(required(values, rule.field))),
  }));
  const protein = favourable.find(
    (entry) => entry.rule.component === 'protein',
  );
  if (protein === undefined) {
    return refuse('method_unavailable', route, null, ISSUES.methodUnavailable);
  }
  const decision = decideProtein(
    rules,
    protein.rule,
    pointsA,
    protein.scored.points,
    facts,
  );
  if (decision.issues.length > 0) {
    return refuseAll('insufficient_data', route, identity, decision.issues);
  }

  let pointsC = 0;
  const counted: string[] = [];
  for (const { rule, scored } of favourable) {
    const isProtein = rule.component === 'protein';
    const points = isProtein ? decision.points : scored.points;
    const isCounted = isProtein ? decision.counted : true;
    if (isCounted) {
      pointsC += points;
      counted.push(rule.component);
    }
    trace.push({
      component: rule.component,
      inputFields: [rule.field],
      points,
      ruleLocator:
        isProtein &&
        decision.traceExtras.redMeatCap === 'applied' &&
        rule.redMeatCap
          ? rule.redMeatCap.ruleLocator
          : rule.table.ruleLocator,
      citationIds: rules.citationIds,
      evaluation: scored.evaluation,
      counted: isCounted,
      ...(isProtein ? decision.traceExtras : {}),
    });
  }
  trace.push({
    component: 'points_c',
    inputFields: counted,
    points: pointsC,
    ruleLocator: rules.proteinRule.ruleLocator,
    citationIds: rules.citationIds,
    note: 'Sum of the favourable points that are subtracted.',
  });

  const score = pointsA - pointsC;
  trace.push({
    component: 'final_score',
    inputFields: ['points_a', 'points_c'],
    points: score,
    ruleLocator: rules.proteinRule.ruleLocator,
    citationIds: rules.citationIds,
    note: `Score = Points A (${pointsA}) - Points C (${pointsC}); ${decision.formula}`,
  });

  const range = rules.letters.find((entry) => inRange(entry, score));
  if (range === undefined) {
    return refuse('method_unavailable', route, null, ISSUES.methodUnavailable);
  }
  const result: GradedResult = {
    state: 'graded',
    grade: range.letter,
    score,
    route,
    method: identity,
    trace,
    letterBoundary: {
      letter: range.letter,
      minScore: range.minScore,
      maxScore: range.maxScore,
      rule: 'score_range',
      ruleLocator: rules.scoringRuleLocator,
      citationIds: rules.citationIds,
    },
    facts: factUses(facts, decision),
    issues: [],
  };
  return result;
}

function gradeWater(
  identity: MethodIdentity,
  rules: RouteMethod,
  facts: ResolvedFacts,
): NutriScoreResult {
  const letter = rules.waterLetter;
  if (letter === null) {
    return refuse(
      'method_unavailable',
      rules.route,
      null,
      ISSUES.methodUnavailable,
    );
  }
  const note =
    'Supported plain water is classified without calculation. The score 0 follows the canonical vector convention; it is not a computed score.';
  return {
    state: 'graded',
    grade: letter,
    score: 0,
    route: rules.route,
    method: identity,
    trace: [
      {
        component: 'water_classification',
        inputFields: ['category', 'plainWater'],
        points: 0,
        ruleLocator: rules.scoringRuleLocator,
        citationIds: rules.citationIds,
        note,
      },
    ],
    letterBoundary: {
      letter,
      minScore: null,
      maxScore: null,
      rule: 'plain_water',
      ruleLocator: rules.scoringRuleLocator,
      citationIds: rules.citationIds,
    },
    facts: {
      cheese: notApplicableUse(facts.cheese),
      redMeat: notApplicableUse(facts.redMeat),
      plainWater: {
        state: facts.plainWater.state,
        effect: 'applied',
        detail: 'Plain water takes the water rule.',
      },
      nonNutritiveSweetener: {
        state: facts.nonNutritiveSweetener.state,
        effect: 'not_applicable',
        detail: 'The water rule applies without calculating points.',
      },
    },
    issues: [],
  };
}

// ---------------------------------------------------------------- facts

function readFacts(input: NutriScoreInput): {
  states: Record<ScoringFactName, FactState>;
  issues: CalculationIssue[];
} {
  const raw = ownField(input, 'facts');
  const issues: CalculationIssue[] = [];
  const states = {} as Record<ScoringFactName, FactState>; // filled below for every name
  for (const name of FACT_NAMES) {
    const value = ownField(raw, name);
    if (value === undefined) {
      // ADR 013: an omitted fact is unknown, never absent.
      states[name] = 'unknown';
    } else if (
      value === 'present' ||
      value === 'absent' ||
      value === 'unknown'
    ) {
      states[name] = value;
    } else {
      states[name] = 'unknown';
      issues.push({
        code: 'invalid_fact',
        stage: 'completeness',
        field: name,
        message: `The ${FACT_LABELS[name]} fact must be present, absent or unknown.`,
        action: 'read_source',
      });
    }
  }
  return { states, issues };
}

function contradictions(
  route: NutriScoreRoute,
  states: Readonly<Record<ScoringFactName, FactState>>,
): CalculationIssue[] {
  const issues: CalculationIssue[] = [];
  const conflict = (field: ScoringFactName, message: string) =>
    issues.push({
      code: 'contradictory_facts',
      stage: 'method',
      field,
      message,
      action: 'read_source',
    });
  if (states.cheese === 'present' && states.redMeat === 'present') {
    conflict(
      'redMeat',
      'Cheese and red meat cannot both apply to one product.',
    );
  }
  if (
    states.plainWater === 'present' &&
    states.nonNutritiveSweetener === 'present'
  ) {
    conflict(
      'nonNutritiveSweetener',
      'Plain water cannot contain a non-nutritive sweetener.',
    );
  }
  for (const name of ['cheese', 'redMeat'] as const) {
    if (route !== 'general' && states[name] === 'present') {
      conflict(
        name,
        `The ${FACT_LABELS[name]} rule applies only to general foods, but the category is ${route}.`,
      );
    }
  }
  if (route !== 'beverage' && states.plainWater === 'present') {
    conflict(
      'plainWater',
      `The plain-water rule applies only to beverages, but the category is ${route}.`,
    );
  }
  return issues;
}

/**
 * Cheese and red meat are separate method categories, and plain water has no
 * sweetener, so a present fact settles its unknown partner as absent. Facts
 * without a rule on this route are marked not applicable.
 */
function resolveFacts(
  route: NutriScoreRoute,
  states: Readonly<Record<ScoringFactName, FactState>>,
): ResolvedFacts {
  const routeOnly = (
    name: ScoringFactName,
    routes: readonly NutriScoreRoute[],
  ) =>
    routes.includes(route)
      ? null
      : `This route has no ${FACT_LABELS[name]} rule.`;
  const excludedBy = (
    name: ScoringFactName,
    partner: ScoringFactName,
    reason: string,
  ): ResolvedFact => {
    const own = routeOnly(
      name,
      name === 'cheese' || name === 'redMeat' ? ['general'] : ['beverage'],
    );
    if (own !== null) {
      return {
        state: states[name],
        resolved: states[name],
        notApplicable: own,
      };
    }
    if (states[name] === 'unknown' && states[partner] === 'present') {
      return { state: 'unknown', resolved: 'absent', notApplicable: reason };
    }
    return { state: states[name], resolved: states[name], notApplicable: null };
  };
  return {
    cheese: excludedBy(
      'cheese',
      'redMeat',
      'Red meat is present, so the product is not cheese.',
    ),
    redMeat: excludedBy(
      'redMeat',
      'cheese',
      'The product is cheese, so it is not red meat.',
    ),
    plainWater: excludedBy(
      'plainWater',
      'nonNutritiveSweetener',
      'A non-nutritive sweetener is present, so the product is not plain water.',
    ),
    nonNutritiveSweetener: excludedBy(
      'nonNutritiveSweetener',
      'plainWater',
      'The product is plain water.',
    ),
  };
}

function factUnknown(
  code: 'plain_water_unknown' | 'cheese_unknown' | 'red_meat_unknown',
  field: ScoringFactName,
): CalculationIssue {
  const consequence: Record<typeof code, string> = {
    plain_water_unknown: 'plain water is graded by its own rule',
    cheese_unknown: 'that decides whether protein points are subtracted',
    red_meat_unknown: 'that decides whether protein points are capped',
  };
  return {
    code,
    stage: 'completeness',
    field,
    message: `It is unknown whether this product is ${FACT_LABELS[field]}, and ${consequence[code]}.`,
    action: 'add_field',
  };
}

function notApplicableUse(fact: ResolvedFact): FactUse {
  return {
    state: fact.state,
    effect: 'not_applicable',
    detail: fact.notApplicable ?? 'This rule is not used for this product.',
  };
}

// ------------------------------------------------------------ nutrients

function readNutrients(
  input: NutriScoreInput,
  rules: RouteMethod,
): {
  values: Partial<Record<NutriScoreNutrient, Decimal>>;
  issues: CalculationIssue[];
} {
  const raw = ownField(input, 'nutrients');
  const values: Partial<Record<NutriScoreNutrient, Decimal>> = {};
  const issues: CalculationIssue[] = [];
  for (const field of requiredFields(rules)) {
    const result = readAmount(field, ownField(raw, field), rules.basis);
    if ('issue' in result) {
      issues.push(result.issue);
    } else {
      values[field] = result.value;
    }
  }
  const saturates = values.saturates;
  const fat = values.fat;
  if (rules.route === 'fats_nuts_seeds' && saturates && fat) {
    if (fat.significand === 0n) {
      issues.push({
        code: 'saturates_ratio_undefined',
        stage: 'method',
        field: 'fat',
        message:
          'Total fat is zero, so the saturated-fat share of fat cannot be calculated.',
        action: 'read_source',
      });
    } else if (compareDecimals(saturates, fat) > 0) {
      issues.push({
        code: 'saturates_exceed_fat',
        stage: 'completeness',
        field: 'saturates',
        message: 'Saturated fat cannot be more than total fat.',
        action: 'edit',
      });
    }
  }
  return { values, issues };
}

function requiredFields(rules: RouteMethod): NutriScoreNutrient[] {
  const fields: NutriScoreNutrient[] = [];
  const add = (field: NutriScoreNutrient) => {
    if (!fields.includes(field)) {
      fields.push(field);
    }
  };
  for (const rule of rules.adverse) {
    if (rule.kind === 'declared') {
      add(rule.field);
    } else if (rule.kind === 'energy_from_saturates') {
      add('saturates');
    } else if (rule.kind === 'saturates_ratio') {
      add('saturates');
      add('fat');
    }
  }
  for (const rule of rules.favourable) {
    add(rule.field);
  }
  return fields;
}

function readAmount(
  field: NutriScoreNutrient,
  raw: unknown,
  basis: RouteMethod['basis'],
): { value: Decimal } | { issue: CalculationIssue } {
  const label = FIELD_LABELS[field];
  const issue = (
    code: string,
    message: string,
    action: CalculationIssue['action'],
    stage: CalculationIssue['stage'] = 'completeness',
  ) => ({ issue: { code, stage, field, message, action } });
  if (raw === undefined) {
    return issue(
      `missing_${field}`,
      `${label} is not available for this calculation.`,
      'add_field',
    );
  }
  const value = ownField(raw, 'value');
  const unit = FIELD_UNITS[field];
  const decimal = typeof value === 'number' ? decimalFromNumber(value) : null;
  if (decimal === null) {
    return issue(
      'invalid_value',
      `${label} must be a number that is zero or more.`,
      'edit',
    );
  }
  if (ownField(raw, 'unit') !== unit) {
    return issue(
      'unsupported_unit',
      `${label} must be stated in ${unit}.`,
      'edit',
    );
  }
  if (ownField(raw, 'basis') !== basis) {
    const per = basis === 'per_100_g' ? '100 g' : '100 ml';
    return issue(
      'unsupported_basis',
      `${label} must be stated per ${per} for this category.`,
      'read_source',
      'method',
    );
  }
  if (typeof value === 'number' && value > UPPER_LIMIT[unit]) {
    return issue(
      'out_of_range',
      `${label} is above the largest possible value.`,
      'edit',
    );
  }
  return { value: decimal };
}

function required(
  values: Partial<Record<NutriScoreNutrient, Decimal>>,
  field: NutriScoreNutrient,
): Decimal {
  const value = values[field];
  if (value === undefined) {
    throw new Error(`unreachable: ${field} was checked before scoring`);
  }
  return value;
}

// --------------------------------------------------------------- points

/** A compared amount: numerator / denominator, kept exact. */
interface Quantity {
  readonly numerator: Decimal;
  readonly denominator: Decimal | null;
  readonly text: string;
  readonly approximate: boolean;
  readonly derivation: string | null;
}

function plainQuantity(value: Decimal): Quantity {
  return {
    numerator: value,
    denominator: null,
    text: decimalText(value),
    approximate: false,
    derivation: null,
  };
}

function scoreTable(
  table: PointsTable,
  quantity: Quantity,
): { points: number; evaluation: ComponentEvaluation } {
  let count = 0;
  for (const threshold of table.thresholds) {
    const scaled =
      quantity.denominator === null
        ? threshold
        : multiplyDecimals(threshold, quantity.denominator);
    const order = compareDecimals(quantity.numerator, scaled);
    if (order > 0 || (order === 0 && table.operator === '>=')) {
      count += 1;
    } else {
      break;
    }
  }
  const points = table.points[count];
  if (points === undefined) {
    throw new Error('unreachable: points table was validated');
  }
  return {
    points,
    evaluation: {
      value: quantity.text,
      approximate: quantity.approximate,
      unit: table.unit,
      basis: table.basis,
      derivation: quantity.derivation,
      operator: table.operator,
      passedThreshold:
        count > 0 ? (table.thresholdValues[count - 1] ?? null) : null,
      nextThreshold: table.thresholdValues[count] ?? null,
      maxPoints: maxPoints(table),
    },
  };
}

function adverseStep(
  rule: AdverseRule,
  values: Partial<Record<NutriScoreNutrient, Decimal>>,
  facts: ResolvedFacts,
  rules: RouteMethod,
): TraceStep {
  const base = { citationIds: rules.citationIds };
  if (rule.kind === 'sweetener_presence') {
    const present = facts.nonNutritiveSweetener.resolved === 'present';
    return {
      ...base,
      component: rule.component,
      inputFields: ['nonNutritiveSweetener'],
      points: present ? rule.pointsIfPresent : rule.pointsIfAbsent,
      ruleLocator: rule.ruleLocator,
      note: present
        ? 'A non-nutritive sweetener is present.'
        : 'No non-nutritive sweetener is present.',
    };
  }
  let quantity: Quantity;
  let inputFields: string[];
  if (rule.kind === 'declared') {
    quantity = plainQuantity(required(values, rule.field));
    inputFields = [rule.field];
  } else if (rule.kind === 'energy_from_saturates') {
    const saturates = required(values, 'saturates');
    const energy = multiplyDecimals(saturates, rule.factorKjPerGram);
    quantity = {
      ...plainQuantity(energy),
      derivation: `${decimalText(saturates)} g saturates x ${rule.factorText} kJ/g = ${decimalText(energy)} kJ`,
    };
    inputFields = ['saturates'];
  } else {
    const saturates = required(values, 'saturates');
    const fat = required(values, 'fat');
    const numerator = multiplyDecimals(saturates, {
      significand: 100n,
      scale: 0,
    });
    const shown = divideForDisplay(numerator, fat, 2);
    quantity = {
      numerator,
      denominator: fat,
      text: shown.text,
      approximate: !shown.exact,
      derivation: `${decimalText(saturates)} g saturates / ${decimalText(fat)} g fat x 100`,
    };
    inputFields = ['saturates', 'fat'];
  }
  const scored = scoreTable(rule.table, quantity);
  return {
    ...base,
    component: rule.component,
    inputFields,
    points: scored.points,
    ruleLocator: rule.table.ruleLocator,
    evaluation: scored.evaluation,
  };
}

// -------------------------------------------------------------- protein

interface ProteinDecision {
  readonly counted: boolean;
  readonly points: number;
  readonly formula: string;
  readonly traceExtras: Pick<
    TraceStep,
    'redMeatCap' | 'uncappedPoints' | 'note'
  >;
  readonly cheese: FactUse | null;
  readonly redMeat: FactUse | null;
  readonly issues: CalculationIssue[];
}

function decideProtein(
  rules: RouteMethod,
  proteinRule: FavourableRule,
  pointsA: number,
  rawPoints: number,
  facts: ResolvedFacts,
): ProteinDecision {
  const rule = rules.proteinRule;
  if (rule.kind === 'always') {
    return {
      counted: true,
      points: rawPoints,
      formula: 'all favourable points are subtracted on this route.',
      traceExtras: {},
      cheese: null,
      redMeat: null,
      issues: [],
    };
  }
  const limit = rule.pointsAThreshold;
  const below = pointsA < limit;
  const formulaFor = (counted: boolean) =>
    counted
      ? 'protein, fibres and fvl points are subtracted.'
      : `Points A is ${limit} or more, so only fibres and fvl points are subtracted.`;
  if (!rule.cheeseException) {
    return {
      counted: below,
      points: rawPoints,
      formula: formulaFor(below),
      traceExtras: {
        note: below
          ? `Points A (${pointsA}) is below ${limit}, so protein counts.`
          : `Points A (${pointsA}) is ${limit} or more, so protein does not count.`,
      },
      cheese: null,
      redMeat: null,
      issues: [],
    };
  }

  const issues: CalculationIssue[] = [];
  const cheese = facts.cheese;
  let counted: boolean | null;
  let cheeseUse: FactUse;
  if (below) {
    counted = true;
    cheeseUse = {
      state: cheese.state,
      effect: 'no_effect',
      detail: `Points A (${pointsA}) is below ${limit}, so protein counts whether or not the product is cheese.`,
    };
  } else if (cheese.resolved === 'present') {
    counted = true;
    cheeseUse = {
      state: cheese.state,
      effect: 'applied',
      detail: `Points A (${pointsA}) is ${limit} or more, and cheese keeps its protein points.`,
    };
  } else if (cheese.resolved === 'absent') {
    counted = false;
    cheeseUse =
      cheese.notApplicable === null
        ? {
            state: cheese.state,
            effect: 'applied',
            detail: `Points A (${pointsA}) is ${limit} or more and the product is not cheese, so protein does not count.`,
          }
        : notApplicableUse(cheese);
  } else if (rawPoints === 0) {
    counted = false;
    cheeseUse = {
      state: cheese.state,
      effect: 'no_effect',
      detail:
        'Protein earns 0 points, so counting it or not gives the same score.',
    };
  } else {
    counted = null;
    cheeseUse = {
      state: cheese.state,
      effect: 'no_effect',
      detail: 'Unresolved.',
    };
    issues.push(factUnknown('cheese_unknown', 'cheese'));
  }

  const cap = proteinRule.redMeatCap;
  const redMeat = facts.redMeat;
  let points = rawPoints;
  let capUse: RedMeatCapUse = 'not_applicable';
  let redMeatUse: FactUse;
  const capMatters =
    counted === true && cap !== null && rawPoints > cap.maxPoints;
  if (cap === null) {
    redMeatUse = notApplicableUse(redMeat);
  } else if (redMeat.notApplicable !== null) {
    redMeatUse = notApplicableUse(redMeat);
  } else if (redMeat.resolved === 'present') {
    if (capMatters) {
      points = cap.maxPoints;
      capUse = 'applied';
    } else {
      capUse = counted === false ? 'not_evaluated' : 'cannot_bind';
    }
    redMeatUse = capMatters
      ? {
          state: redMeat.state,
          effect: 'applied',
          detail: `Red meat caps protein at ${cap.maxPoints} points.`,
        }
      : {
          state: redMeat.state,
          effect: 'no_effect',
          detail: capNoEffect(counted, rawPoints, cap.maxPoints),
        };
  } else if (redMeat.resolved === 'absent') {
    redMeatUse = capMatters
      ? {
          state: redMeat.state,
          effect: 'applied',
          detail: 'The product is not red meat, so protein is not capped.',
        }
      : {
          state: redMeat.state,
          effect: 'no_effect',
          detail: capNoEffect(counted, rawPoints, cap.maxPoints),
        };
  } else if (rawPoints <= cap.maxPoints) {
    capUse = 'cannot_bind';
    redMeatUse = {
      state: redMeat.state,
      effect: 'no_effect',
      detail: capNoEffect(counted, rawPoints, cap.maxPoints),
    };
  } else if (counted === false) {
    capUse = 'not_evaluated';
    redMeatUse = {
      state: redMeat.state,
      effect: 'no_effect',
      detail: capNoEffect(false, rawPoints, cap.maxPoints),
    };
  } else {
    // counted is true, or unresolved because cheese is unknown; in the cheese
    // case red meat is excluded, so only a counted protein needs this fact.
    redMeatUse = {
      state: redMeat.state,
      effect: 'no_effect',
      detail: 'Unresolved.',
    };
    if (counted === true) {
      issues.push(factUnknown('red_meat_unknown', 'redMeat'));
    }
  }

  const isCounted = counted === true;
  const capped = capUse === 'applied' && points !== rawPoints;
  return {
    counted: isCounted,
    points,
    formula: formulaFor(isCounted),
    traceExtras: {
      redMeatCap: capUse,
      ...(capped ? { uncappedPoints: rawPoints } : {}),
      note: cheeseUse.detail,
    },
    cheese: cheeseUse,
    redMeat: redMeatUse,
    issues,
  };
}

function capNoEffect(
  counted: boolean | null,
  rawPoints: number,
  cap: number,
): string {
  if (counted !== true) {
    return 'Protein does not count, so the red-meat cap cannot change the score.';
  }
  return `Protein earns ${rawPoints} points, at or below the red-meat cap of ${cap}, so the cap changes nothing.`;
}

function factUses(
  facts: ResolvedFacts,
  decision: ProteinDecision,
): Record<ScoringFactName, FactUse> {
  const beverageFact = (
    name: 'plainWater' | 'nonNutritiveSweetener',
  ): FactUse => {
    const fact = facts[name];
    if (fact.notApplicable !== null) {
      return notApplicableUse(fact);
    }
    return {
      state: fact.state,
      effect: 'applied',
      detail:
        name === 'plainWater'
          ? 'The product is not plain water, so beverage points apply.'
          : fact.resolved === 'present'
            ? 'A non-nutritive sweetener adds adverse points.'
            : 'No non-nutritive sweetener is present, so no sweetener points apply.',
    };
  };
  return {
    cheese: decision.cheese ?? notApplicableUse(facts.cheese),
    redMeat: decision.redMeat ?? notApplicableUse(facts.redMeat),
    plainWater: beverageFact('plainWater'),
    nonNutritiveSweetener: beverageFact('nonNutritiveSweetener'),
  };
}

// --------------------------------------------------------------- helpers

function refuse(
  state: RefusedResult['state'],
  route: NutriScoreRoute | null,
  method: MethodIdentity | null,
  issue: CalculationIssue,
): RefusedResult {
  return { state, route, method, issues: [issue] };
}

function refuseAll(
  state: RefusedResult['state'],
  route: NutriScoreRoute,
  method: MethodIdentity,
  issues: readonly CalculationIssue[],
): RefusedResult {
  const [first, ...rest] = issues;
  if (first === undefined) {
    throw new Error('unreachable: refusal without an issue');
  }
  return { state, route, method, issues: [first, ...rest] };
}

function isRoute(value: unknown): value is NutriScoreRoute {
  return ROUTES.some((route) => route === value);
}

/** Reads an own property without trusting the runtime shape of the input. */
function ownField(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  return Object.prototype.hasOwnProperty.call(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}
