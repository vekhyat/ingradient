/**
 * generated, do not edit
 *
 * Produced by src/domain/contracts/codegen/generate.mjs.
 * The drift test regenerates this file in memory and fails if the text differs.
 */

/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "Grade".
 */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';
/**
 * LOCAL ONLY. Graded example demonstrates shape, not valid method arithmetic. Zero hash is fictional fixture metadata, never an artifact checksum.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "ScientificAssessment".
 */
export type ScientificAssessment =
  | {
      state: 'graded';
      grade: Grade;
      /**
       * Union of route bounds: general and fats/nuts/seeds -17..55, beverage -18..54. Domain validation checks the route-specific bound.
       */
      score: number;
      route: 'general' | 'fats_nuts_seeds' | 'beverage';
      method: MethodRef;
      inputSnapshotId: string;
      /**
       * @minItems 1
       */
      reasons: [ScientificReason, ...ScientificReason[]];
      /**
       * @minItems 1
       */
      trace: [TraceStep, ...TraceStep[]];
      issues: Issue[];
    }
  | {
      state: 'insufficient_data' | 'unsupported' | 'method_unavailable';
      inputSnapshotId: string;
      reasons: ScientificReason[];
      /**
       * @minItems 1
       */
      issues: [Issue, ...Issue[]];
    };
/**
 * LOCAL ONLY. Never sent as a request/response. Hard or unavailable outcomes have no grade property. Cross-field policy invariants require domain validation.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "PersonalAssessment".
 */
export type PersonalAssessment =
  | {
      state: 'hard_conflict';
      profileVersion: string;
      policyVersion: string;
      /**
       * @minItems 1
       */
      findings: [HardFinding, ...HardFinding[]];
    }
  | {
      state: 'hard_uncertain';
      profileVersion: string;
      policyVersion: string;
      /**
       * @minItems 1
       */
      findings: [
        HardFinding & {
          state?: unknown;
        },
        ...(HardFinding & {
          state?: unknown;
        })[],
      ];
    }
  | {
      state: 'graded';
      grade: Grade;
      profileVersion: string;
      policyVersion: string;
      findings: (HardFinding & {
        state?: 'no_conflict_detected';
      })[];
      effects: PersonalEffect[];
      experimental: true;
    }
  | {
      state: 'baseline_only';
      grade: Grade;
      profileVersion: string;
      policyVersion: string;
      findings: (HardFinding & {
        state?: 'no_conflict_detected';
      })[];
      /**
       * @maxItems 0
       */
      effects: [];
      experimental: true;
    }
  | {
      state: 'not_in_slice' | 'insufficient_data' | 'policy_unavailable';
      issues: Issue[];
    };
/**
 * Local adapter result for direct OFF reads; not an Ingradient network response.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "LookupOutcome".
 */
export type LookupOutcome =
  | {
      state: 'found';
      snapshot: ProductSnapshot;
    }
  | {
      state:
        | 'invalid'
        | 'absent'
        | 'offline'
        | 'timeout'
        | 'throttled'
        | 'upstream_unavailable'
        | 'malformed'
        | 'cancelled';
      issues: Issue[];
      retryAfterSeconds?: number;
    };
/**
 * ADR013 (D146). present or absent: at least one source of this product supports the fact. unknown: no supporting evidence, and no sources. Unknown differs from an observed absence; a missing category tag or an incomplete ingredient list never proves absence.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "PresenceFact".
 */
export type PresenceFact =
  | {
      state: 'present' | 'absent';
      /**
       * @minItems 1
       */
      sourceIds: [string, ...string[]];
    }
  | {
      state: 'unknown';
    };
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "NutrientObservation".
 */
export type NutrientObservation =
  | {
      field: string;
      /**
       * @minItems 1
       */
      sourceIds: [string, ...string[]];
      unit: 'g' | 'kJ' | 'percent';
      basis: 'per_100_g' | 'per_100_ml' | 'per_serving';
      /**
       * @maxItems 12
       */
      derivation?: string[];
      kind: 'read';
      value: number;
      issues: Issue[];
    }
  | {
      field: string;
      /**
       * @minItems 1
       */
      sourceIds: [string, ...string[]];
      unit: 'g' | 'kJ' | 'percent';
      basis: 'per_100_g' | 'per_100_ml' | 'per_serving';
      /**
       * @maxItems 12
       */
      derivation?: string[];
      kind: 'uncertain';
      value: number;
      /**
       * @minItems 1
       */
      issues: [Issue, ...Issue[]];
    }
  | {
      field: string;
      /**
       * @minItems 1
       */
      sourceIds: [string, ...string[]];
      unit: 'g' | 'kJ' | 'percent';
      basis: 'per_100_g' | 'per_100_ml' | 'per_serving';
      /**
       * @maxItems 12
       */
      derivation?: string[];
      kind: 'corrected';
      value: number;
      issues: Issue[];
      /**
       * @minItems 1
       */
      previousSourceIds: [string, ...string[]];
    }
  | {
      field: string;
      /**
       * @minItems 1
       */
      sourceIds: [string, ...string[]];
      unit: 'g' | 'kJ' | 'percent';
      basis: 'per_100_g' | 'per_100_ml' | 'per_serving';
      /**
       * @maxItems 12
       */
      derivation?: string[];
      kind: 'estimated';
      value: number;
      issues: Issue[];
      modelId: string;
      modelVersion: string;
    }
  | {
      field: string;
      kind: 'missing';
      reason:
        | 'not_declared'
        | 'unreadable'
        | 'ambiguous'
        | 'unsupported_basis'
        | 'conflicting_sources'
        | 'not_available';
      issues: Issue[];
    };

/**
 * Proposed canonical local schema projection, frozen independently from optional public wire paths. No network operation is authorised.
 */
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "Citation".
 */
export interface Citation {
  id: string;
  title: string;
  issuer: string;
  url: string;
  edition: string;
  locator: string;
  claimScope: string;
  checkedAt: string;
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "HardFinding".
 */
export interface HardFinding {
  requirementId: string;
  kind: 'allergy' | 'strict';
  state:
    | 'confirmed_conflict'
    | 'possible_conflict'
    | 'no_conflict_detected'
    | 'insufficient_information';
  message: string;
  sourceIds: string[];
  issues: Issue[];
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "Issue".
 */
export interface Issue {
  code: string;
  stage:
    | 'lookup'
    | 'capture'
    | 'extraction'
    | 'matching'
    | 'completeness'
    | 'method'
    | 'personal'
    | 'storage';
  field?: string;
  message: string;
  action:
    | 'retake'
    | 'edit'
    | 'choose_candidate'
    | 'add_field'
    | 'retry'
    | 'read_source'
    | 'none';
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "IngredientMention".
 */
export interface IngredientMention {
  id: string;
  text: string;
  parentId: string | null;
  canonicalId: string | null;
  state: 'matched' | 'ambiguous' | 'unresolved';
  /**
   * @maxItems 20
   */
  candidateIds: string[];
  /**
   * @minItems 1
   */
  sourceIds: [string, ...string[]];
  taxonomyVersion: string;
}
/**
 * LOCAL ONLY. Explicit directional reason, not scan/save/view exposure.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "LearningEvent".
 */
export interface LearningEvent {
  id: string;
  productKey: string;
  featureId: string;
  sign: -1 | 1;
  source: 'not_for_me_reason' | 'choice_reason' | 'contrary_feature_reason';
  occurredAt: string;
  gradeWasVisible: boolean;
}
/**
 * LOCAL ONLY. Citation/source existence, snapshot identity, baseline equality and numeric policy caps are validated by domain code in addition to JSON Schema.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "LocalAssessment".
 */
export interface LocalAssessment {
  snapshotId: string;
  scientific: ScientificAssessment;
  personal: PersonalAssessment;
  citations: Citation[];
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "MethodRef".
 */
export interface MethodRef {
  id: string;
  edition: string;
  bundleId: string;
  bundleSha256: string;
  label: 'Nutrition grade · European reference';
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "ScientificReason".
 */
export interface ScientificReason {
  id: string;
  /**
   * Id of a reviewed reason template in the evidence edition. The phone renders the shown sentence from its own copy of that template; it never displays server text directly.
   */
  templateId: string;
  text: string;
  /**
   * @minItems 1
   */
  citationIds: [string, ...string[]];
  inputFields: string[];
  step: string;
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "TraceStep".
 */
export interface TraceStep {
  component: string;
  inputFields: string[];
  points: number;
  ruleLocator: string;
  /**
   * @minItems 1
   */
  citationIds: [string, ...string[]];
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "PersonalEffect".
 */
export interface PersonalEffect {
  preferenceId: string;
  source: 'you_set' | 'learned';
  feature: string;
  penalty: number;
  message: string;
  policyVersion: string;
}
/**
 * LOCAL ONLY. Thirty-day influence window and reset semantics are policy invariants.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "LocalLearningState".
 */
export interface LocalLearningState {
  policyVersion: 'personal-exp-1';
  enabled: boolean;
  events: LearningEvent[];
  suppressedFeatureIds: string[];
}
/**
 * LOCAL ONLY. IDs must resolve in accepted regional/scope catalogues. No inferred allergy or strictness.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "LocalProfile".
 */
export interface LocalProfile {
  version: string;
  allergies: string[];
  strictRequirements: string[];
  softPreferences: {
    id: string;
    targetId: string;
    kind: 'nutrient' | 'ingredient' | 'class';
    emphasis: 1 | 2;
  }[];
}
/**
 * LOCAL ONLY. ADR013 (D146): category and scoringFacts are optional; omission means unknown, never general or absent. categorySourceIds must be empty unless the category is known. Cheese and red meat are general-route facts and plain water is a beverage-route fact, so a stated category of another route contradicts them. Snapshots saved before local contract 0.3.0-draft have no scoringFacts and still load: their facts are unknown. Source and citation existence are validated by domain code.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "ProductSnapshot".
 */
export interface ProductSnapshot {
  id: string;
  barcode: string | null;
  name: string | null;
  market: 'IN' | 'EU' | 'unknown';
  capturedAt: string;
  sourceRefs: SourceRef[];
  /**
   * @maxItems 100
   */
  observations: NutrientObservation[];
  /**
   * @maxItems 300
   */
  ingredients: IngredientMention[];
  /**
   * @maxItems 2
   */
  panels: PanelRegion[];
  category: 'general' | 'fats_nuts_seeds' | 'beverage' | 'excluded' | 'unknown';
  scoringFacts?: ScoringFacts;
  taxonomyVersion: string;
  evidenceVersion: string;
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "SourceRef".
 */
export interface SourceRef {
  id: string;
  kind: 'off' | 'label' | 'user_correction' | 'model' | 'official';
  title: string;
  url?: string;
  edition?: string;
  locator?: string;
}
/**
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "PanelRegion".
 */
export interface PanelRegion {
  panel: 'ingredients' | 'nutrition';
  state: 'read' | 'uncertain' | 'missing' | 'user_marked_absent';
  imageId: string | null;
  regionId: string | null;
  text?: string;
  issues: Issue[];
}
/**
 * ADR013 (D146). Source-backed facts that select Nutri-Score route exceptions. Omit the whole object when nothing is known: omission means every fact is unknown and category provenance is unavailable, never absent or general. A partial object is invalid. Each id appears once per list and must name a sourceRef of the same product (domain validation). Plain water excludes a present cheese, red-meat or sweetener fact. Examples are fictional shape checks, not product data.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "ScoringFacts".
 */
export interface ScoringFacts {
  /**
   * Sources supporting the product category. Empty when the category is unknown or not stated.
   */
  categorySourceIds: string[];
  cheese: PresenceFact;
  redMeat: PresenceFact;
  plainWater: PresenceFact;
  nonNutritiveSweetener: PresenceFact;
}
/**
 * LOCAL ONLY. Proposed experimental engineering policy, not accepted or scientifically validated parameters.
 *
 * This interface was referenced by `LocalContract`'s JSON-Schema
 * via the `definition` "PersonalPolicyConfig".
 */
export interface PersonalPolicyConfig {
  version: 'personal-exp-1';
  confirmedCap: 2;
  learnedCap: 0.5;
  totalCap: 2;
  minimumProducts: 5;
  minimumDays: 3;
  minimumPositiveSupport: 3;
  supportRatio: 0.8;
  halfLifeDays: 14;
  expiryDays: 30;
  rounding: 'half_up_nonnegative';
  direction: 'downward_only';
}
