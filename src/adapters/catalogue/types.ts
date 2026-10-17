import type {
  IngredientMention,
  Issue,
  LookupOutcome,
  NutrientObservation,
  PanelRegion,
  ProductSnapshot,
  SourceRef,
} from '../../domain/contracts/generated/local';
import reasonTemplatesJson from '../../../resources/evidence/reason-templates.json';
import manifestJson from '../../../resources/manifest.json';

export type {
  IngredientMention,
  Issue,
  LookupOutcome,
  NutrientObservation,
  PanelRegion,
  ProductSnapshot,
  SourceRef,
};

/**
 * Installed resource editions, read from the pinned files so phone and
 * backend name the same editions (BE-12 uses the same rules).
 * - Taxonomy: OFF ingredient bundle id @ manifest revision.
 * - Evidence: the reason-template edition (evidenceEdition). This is not the
 *   Nutri-Score method identity, which the request names separately.
 */
export const DEFAULT_TAXONOMY_VERSION = `off-taxonomy-ingredients@${manifestJson.revision}`;
export const DEFAULT_EVIDENCE_VERSION: string =
  reasonTemplatesJson.evidenceEdition;

/**
 * Configuration for the Open Food Facts catalogue adapter.
 */
export interface CatalogueConfig {
  /**
   * Identifying User-Agent header string.
   * Required by Open Food Facts terms of service.
   * Must follow: <App-Name> - <Platform> - Version <Version> - <URL or contact>
   * or AppName/Version (ContactEmail).
   */
  readonly userAgent: string;

  /**
   * Base URL for the Open Food Facts API.
   * Defaults to 'https://world.openfoodfacts.org'.
   */
  readonly baseUrl?: string;

  /**
   * Explicit list of fields to request in the v3 product endpoint.
   * Defaults to the minimal required set for Ingradient facts.
   */
  readonly fields?: readonly string[];

  /**
   * Request timeout in milliseconds.
   * Defaults to 8000 (8 seconds per pipeline SLA).
   */
  readonly timeoutMs?: number;

  /**
   * Injected fetch function for network-free testing.
   * Defaults to globalThis.fetch.
   */
  readonly fetch?: typeof fetch;

  /**
   * Explicit developer flag. When false, product barcodes and query URLs
   * are never logged. When true, high-level adapter trace logs are emitted.
   * Personal user data is NEVER logged regardless of this setting.
   */
  readonly debug?: boolean;

  /**
   * Default cooldown duration in seconds if an HTTP 429 response
   * does not supply a valid Retry-After header. Defaults to 60.
   */
  readonly defaultCooldownSeconds?: number;

  /**
   * Clock function returning the current epoch timestamp in milliseconds.
   * Defaults to Date.now.
   */
  readonly clock?: () => number;

  /**
   * Active taxonomy version tag.
   * Defaults to DEFAULT_TAXONOMY_VERSION (ingredient bundle @ manifest revision).
   */
  readonly taxonomyVersion?: string;

  /**
   * Evidence (reason-template) edition.
   * Defaults to DEFAULT_EVIDENCE_VERSION (reason-templates.json evidenceEdition).
   */
  readonly evidenceVersion?: string;
}

/**
 * Per-lookup execution options.
 */
export interface LookupOptions {
  /**
   * Optional external AbortSignal to cancel this specific lookup.
   */
  readonly signal?: AbortSignal;
}

/**
 * Raw Open Food Facts v3 product payload structure (subset used for mapping).
 */
export interface OffProductV3 {
  readonly code?: string;
  readonly product_name?: string;
  readonly product_name_en?: string;
  readonly brands?: string;
  readonly quantity?: string;
  readonly product_quantity?: number;
  readonly product_quantity_unit?: string;
  readonly nutrition_data_per?: string;
  readonly ingredients_text?: string;
  readonly ingredients_text_en?: string;
  readonly ingredients?: readonly OffIngredientV3[];
  readonly nutriments?: Record<string, unknown>;
  readonly countries_tags?: readonly string[];
  readonly categories_tags?: readonly string[];
  readonly rev?: number;
  readonly last_modified_t?: number;
}

export interface OffIngredientV3 {
  readonly id?: string;
  readonly text?: string;
  readonly percent?: number;
  readonly percent_estimate?: number;
  /** OFF term recognition does not assert product-list completeness. */
  readonly is_in_taxonomy?: number;
  readonly vegan?: string;
  readonly vegetarian?: string;
  readonly ingredients?: readonly OffIngredientV3[];
}

export interface OffResponseV3 {
  readonly code?: string;
  readonly status?: string;
  readonly result?: {
    readonly id?: string;
    readonly name?: string;
  };
  readonly errors?: readonly unknown[];
  readonly product?: OffProductV3;
}
