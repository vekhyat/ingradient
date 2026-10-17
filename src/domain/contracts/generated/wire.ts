/**
 * generated, do not edit
 *
 * Produced by src/domain/contracts/codegen/generate.mjs.
 * The drift test regenerates this file in memory and fails if the text differs.
 */

/**
 * LOCAL ONLY. Graded example demonstrates shape, not valid method arithmetic. Zero hash is fictional fixture metadata, never an artifact checksum.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
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
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "Grade".
 */
export type Grade = 'A' | 'B' | 'C' | 'D' | 'E';
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "ProductInputObservation".
 */
export type ProductInputObservation =
  | {
      field: string;
      /**
       * @minItems 1
       *
       * Items: Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
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
       *
       * Items: Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
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
       *
       * Items: Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
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
       *
       * Items: Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
       */
      previousSourceIds: [string, ...string[]];
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
 * ADR013 (D146). present or absent: at least one source of this product supports the fact. unknown: no supporting evidence, and no sources. Unknown differs from an observed absence; a missing category tag or an incomplete ingredient list never proves absence.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "PresenceFact".
 */
export type PresenceFact =
  | {
      state: 'present' | 'absent';
      /**
       * @minItems 1
       *
       * Items: Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
       */
      sourceIds: [string, ...string[]];
    }
  | {
      state: 'unknown';
    };

/**
 * Phone view of the frozen OpenAPI component schemas. Profile and personal state are not in this document.
 */
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
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
    | 'method';
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
 * This interface was referenced by `WireContract`'s JSON-Schema
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
 * This interface was referenced by `WireContract`'s JSON-Schema
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
 * This interface was referenced by `WireContract`'s JSON-Schema
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
 * This interface was referenced by `WireContract`'s JSON-Schema
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
 * This interface was referenced by `WireContract`'s JSON-Schema
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
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "Problem".
 */
export interface Problem {
  code:
    | 'invalid_request'
    | 'payload_too_large'
    | 'not_found'
    | 'rate_limited'
    | 'unavailable';
  message: string;
  retryAfterSeconds?: number;
}
/**
 * Empty bundle list is valid for app-bundled-only S1. Fixture revision is not a published release. Optional remote delivery verifies a detached signature over exact manifest bytes, using an app-pinned key and persistent anti-replay sequence.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "ResourceManifest".
 */
export interface ResourceManifest {
  revision: string;
  sequence: number;
  publishedAt: string;
  /**
   * @maxItems 100
   */
  bundles: BundleDescriptor[];
}
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "BundleDescriptor".
 */
export interface BundleDescriptor {
  bundleId: string;
  sha256: string;
  sizeBytes: number;
  schemaVersion: 1;
  minAppContract: string;
  signature: string;
  signingKeyId: string;
}
/**
 * Public immutable resource bytes. Method bundle activation is separate and requires a pinned, reviewed official-rule artifact; no unverified executable method is returned here.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "ResourceBundle".
 */
export interface ResourceBundle {
  bundleId: string;
  schemaVersion: 1;
  taxonomyVersion: string;
  evidenceVersion: string;
  taxonomy: TaxonomyEntry[];
  evidence: EvidenceEntry[];
  citations: Citation[];
  /**
   * @minItems 1
   */
  licences: [LicenceEntry, ...LicenceEntry[]];
}
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "TaxonomyEntry".
 */
export interface TaxonomyEntry {
  id: string;
  names: {
    en: string;
  };
  /**
   * @maxItems 100
   */
  aliases: string[];
  relationships: {
    type:
      'is_a' | 'synonym_of' | 'derived_from' | 'may_contain' | 'has_function';
    targetId: string;
    /**
     * @minItems 1
     */
    sourceIds: [string, ...string[]];
  }[];
}
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "EvidenceEntry".
 */
export interface EvidenceEntry {
  id: string;
  text: string;
  /**
   * @minItems 1
   */
  citationIds: [string, ...string[]];
  scope: string;
}
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "LicenceEntry".
 */
export interface LicenceEntry {
  id: string;
  name: string;
  url: string;
  attribution: string;
  sourceUrl: string;
  alterationsUrl?: string;
}
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "Health".
 */
export interface Health {
  status: 'ok';
  contractVersion: '0.3.0-draft';
}
/**
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "ProductInputSource".
 */
export interface ProductInputSource {
  /**
   * Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
   */
  id: string;
  kind: 'label' | 'off' | 'user_correction';
  title:
    | 'Ingredient panel'
    | 'Nutrition panel'
    | 'Combined label photo'
    | 'Open Food Facts product'
    | 'User correction';
  /**
   * Open Food Facts product revision (rev-N) or retrieval time in UTC.
   */
  edition?: string;
}
/**
 * ADR013 (D146). Source-backed facts that select Nutri-Score route exceptions. Omit the whole object when nothing is known: omission means every fact is unknown and category provenance is unavailable, never absent or general. A partial object is invalid. Each id appears once per list and must name a sourceRef of the same product (domain validation). Plain water excludes a present cheese, red-meat or sweetener fact. Examples are fictional shape checks, not product data.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "ScoringFacts".
 */
export interface ScoringFacts {
  /**
   * Sources supporting the product category. Empty when the category is unknown or not stated.
   *
   * Items: Per-request local label (src-0, src-1, ...). Carries no stable or device-derived value (D73).
   */
  categorySourceIds: string[];
  cheese: PresenceFact;
  redMeat: PresenceFact;
  plainWater: PresenceFact;
  nonNutritiveSweetener: PresenceFact;
}
/**
 * ADR013 (D146): category and scoringFacts are optional; omission means unknown, never general or absent. categorySourceIds must be empty unless the category is known. Cheese and red meat are general-route facts and plain water is a beverage-route fact, so a stated category of another route contradicts them.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "ProductAnalysisInput".
 */
export interface ProductAnalysisInput {
  barcode: string | null;
  name?: string | null;
  market: 'IN' | 'EU' | 'unknown';
  ingredientsText: string | null;
  ingredientsStatus: 'complete' | 'partial' | 'missing' | 'unreadable';
  /**
   * @maxItems 100
   */
  observations: ProductInputObservation[];
  /**
   * @maxItems 100
   */
  sourceRefs: ProductInputSource[];
  /**
   * @maxItems 100
   */
  issues: Issue[];
  /**
   * Optional (ADR013, D146). Omission means unknown, never general.
   */
  category?:
    'general' | 'fats_nuts_seeds' | 'beverage' | 'excluded' | 'unknown';
  scoringFacts?: ScoringFacts;
}
/**
 * D67 product-only request. No images/crops/coordinates/profile/allergies/behaviour/account/device/session identifiers. Server learning persistence requires separately released D71-D75 policy; payload shape is not consent evidence.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "AnalyzeRequest".
 */
export interface AnalyzeRequest {
  contractVersion: '0.3.0-draft';
  product: ProductAnalysisInput;
  /**
   * Installed public-resource compatibility only; no personal policy/profile version.
   */
  resourceCompatibility: {
    taxonomyVersion: string;
    evidenceVersion: string;
    methodEdition: string;
    methodBundleSha256: string;
  };
}
/**
 * ADR013 (D146): category and scoringFacts are optional; omission means unknown, never general or absent. categorySourceIds must be empty unless the category is known. Cheese and red meat are general-route facts and plain water is a beverage-route fact, so a stated category of another route contradicts them.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "AnalyzedProduct".
 */
export interface AnalyzedProduct {
  id: string;
  barcode: string | null;
  name: string | null;
  market: 'IN' | 'EU' | 'unknown';
  sourceRefs: ProductInputSource[];
  /**
   * @maxItems 100
   */
  observations: ProductInputObservation[];
  /**
   * @maxItems 300
   */
  ingredients: IngredientMention[];
  category: 'general' | 'fats_nuts_seeds' | 'beverage' | 'excluded' | 'unknown';
  scoringFacts?: ScoringFacts;
  taxonomyVersion: string;
  evidenceVersion: string;
}
/**
 * Product/scientific response only. Personal assessment stays local. Domain validation resolves sources and citations, requires scientific.inputSnapshotId = product.id, inputDigest = client digest, and matching taxonomy/evidence/method editions before an update offer; same input/method/resources must pass the shared Python/mobile vectors.
 *
 * This interface was referenced by `WireContract`'s JSON-Schema
 * via the `definition` "AnalyzeResponse".
 */
export interface AnalyzeResponse {
  contractVersion: '0.3.0-draft';
  product: AnalyzedProduct;
  scientific: ScientificAssessment;
  citations: Citation[];
  issues: Issue[];
  /**
   * Lowercase hex SHA-256 of the RFC 8785 (JCS) canonical JSON of the request product value as decoded by the JSON parser, before model validation or defaults, so an absent field and a null field hash differently. The phone hashes the product of JSON.parse(exact body it sent) and offers the result only on equality.
   */
  inputDigest: string;
}
