/**
 * Input and output of the Nutri-Score reference calculation (SCI-01).
 *
 * The input is the calculator's own explicit shape. Mapping a product
 * snapshot into it (PIPE-01) happens elsewhere, so this module does not
 * depend on the product contract. There is deliberately no profile,
 * preference or learning field: the scientific result must not change when
 * personal settings change (ADR 006, BE-05).
 */

/** ADR 013 presence semantics: `unknown` never means `absent`. */
export type FactState = 'present' | 'absent' | 'unknown';

export type ScoringFactName =
  'cheese' | 'redMeat' | 'plainWater' | 'nonNutritiveSweetener';

export type ScoringFactStates = Readonly<Record<ScoringFactName, FactState>>;

/** Same values as the contract's product category. */
export type NutriScoreCategory =
  'general' | 'fats_nuts_seeds' | 'beverage' | 'excluded' | 'unknown';

export type NutriScoreRoute = 'general' | 'fats_nuts_seeds' | 'beverage';

/**
 * Canonical field names from `inputFields` in
 * resources/method/nutriscore-updated-2023.json.
 * `sugars` is total sugars (not added sugars); `salt` is salt, so a
 * sodium-only label must be converted, with its derivation, before this
 * module. `fvl` is the percentage of eligible fruit, vegetables and legumes
 * (and, on the fats route, oils made from them) as the route defines it.
 */
export type NutriScoreNutrient =
  | 'energy'
  | 'sugars'
  | 'saturates'
  | 'salt'
  | 'protein'
  | 'fibre'
  | 'fat'
  | 'fvl';

export type NutrientUnit = 'kJ' | 'g' | 'percent';

export type NutrientBasis = 'per_100_g' | 'per_100_ml' | 'per_serving';

/** A declared amount. Omit the field when the amount is not declared. */
export interface DeclaredAmount {
  readonly value: number;
  readonly unit: NutrientUnit;
  readonly basis: NutrientBasis;
}

export interface NutriScoreInput {
  readonly category: NutriScoreCategory;
  readonly facts: ScoringFactStates;
  readonly nutrients: Readonly<
    Partial<Record<NutriScoreNutrient, DeclaredAmount>>
  >;
}

export type NutriScoreLetter = 'A' | 'B' | 'C' | 'D' | 'E';

export interface MethodIdentity {
  readonly id: string;
  readonly edition: string;
  readonly bundleId: string;
  readonly bundleSha256: string;
  readonly label: string;
}

/** Same shape as the contract `Issue`, restricted to the stages used here. */
export interface CalculationIssue {
  readonly code: string;
  readonly stage: 'completeness' | 'method';
  readonly field?: string;
  readonly message: string;
  readonly action: 'add_field' | 'edit' | 'read_source' | 'none';
}

/** Component names follow resources/vectors/nutriscore-vectors.json. */
export type TraceComponent =
  | 'energy'
  | 'energy_from_saturates'
  | 'sugars'
  | 'saturates'
  | 'saturates_ratio'
  | 'salt'
  | 'sweeteners'
  | 'points_a'
  | 'protein'
  | 'fibres'
  | 'fvl'
  | 'points_c'
  | 'final_score'
  | 'water_classification';

/** How one value was compared with a points table. */
export interface ComponentEvaluation {
  /** Exact compared amount as decimal text (rounded only when `approximate`). */
  readonly value: string;
  readonly approximate: boolean;
  readonly unit: NutrientUnit;
  readonly basis: 'per_100_g' | 'per_100_ml';
  /** How a derived amount was obtained, or null for a declared amount. */
  readonly derivation: string | null;
  /** `>`: a threshold counts when strictly exceeded. `>=`: when met. */
  readonly operator: '>' | '>=';
  /** Highest threshold that counted, or null when none did. */
  readonly passedThreshold: number | null;
  /** Next threshold that would add points, or null at the top of the table. */
  readonly nextThreshold: number | null;
  readonly maxPoints: number;
}

/**
 * `applied`: red meat is present, so protein points are capped.
 * `not_applicable`: red meat is absent, or the product is cheese.
 * `cannot_bind`: red meat is unknown but protein points are at or below the cap.
 * `not_evaluated`: red meat is unknown and protein is not counted, so the cap
 * cannot change the score; `points` shows the uncapped value.
 */
export type RedMeatCapUse =
  'applied' | 'not_applicable' | 'cannot_bind' | 'not_evaluated';

/**
 * The first five fields match the contract `TraceStep`; the rest are
 * calculation evidence for reasons and review.
 */
export interface TraceStep {
  readonly component: TraceComponent;
  readonly inputFields: readonly string[];
  readonly points: number;
  readonly ruleLocator: string;
  readonly citationIds: readonly string[];
  readonly evaluation?: ComponentEvaluation;
  /** Favourable components: whether these points are subtracted. */
  readonly counted?: boolean;
  readonly redMeatCap?: RedMeatCapUse;
  readonly uncappedPoints?: number;
  /** Plain statement of a rule decision (counting, water rule, formula). */
  readonly note?: string;
}

export interface LetterBoundary {
  readonly letter: NutriScoreLetter;
  /** Inclusive score range of the letter; null where the range is open. */
  readonly minScore: number | null;
  readonly maxScore: number | null;
  readonly rule: 'score_range' | 'plain_water';
  readonly ruleLocator: string;
  readonly citationIds: readonly string[];
}

/**
 * `applied`: the fact's known state selected a rule that changes the score.
 * `no_effect`: this route uses the fact, but for this input every state gives
 * the same score (the reason is in `detail`).
 * `not_applicable`: this route has no rule for the fact, or another present
 * fact excludes it.
 */
export interface FactUse {
  readonly state: FactState;
  readonly effect: 'applied' | 'no_effect' | 'not_applicable';
  readonly detail: string;
}

export interface GradedResult {
  readonly state: 'graded';
  readonly grade: NutriScoreLetter;
  readonly score: number;
  readonly route: NutriScoreRoute;
  readonly method: MethodIdentity;
  readonly trace: readonly TraceStep[];
  readonly letterBoundary: LetterBoundary;
  readonly facts: Readonly<Record<ScoringFactName, FactUse>>;
  readonly issues: readonly [];
}

export interface RefusedResult {
  readonly state: 'insufficient_data' | 'unsupported' | 'method_unavailable';
  readonly route: NutriScoreRoute | null;
  readonly method: MethodIdentity | null;
  readonly issues: readonly [CalculationIssue, ...CalculationIssue[]];
}

export type NutriScoreResult = GradedResult | RefusedResult;
