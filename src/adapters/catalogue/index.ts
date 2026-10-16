export { areMatchingGtins, calculateGtinCheckDigit, isValidGtin } from './gtin';

export {
  mapOffProductToSnapshot,
  resolveCategory,
  resolveMarket,
} from './off-mapper';
export type { MapperOptions } from './off-mapper';

export { CooldownManager } from './cooldown';

export {
  DEFAULT_COOLDOWN_SECONDS,
  DEFAULT_OFF_BASE_URL,
  DEFAULT_OFF_FIELDS,
  DEFAULT_TIMEOUT_MS,
  OpenFoodFactsAdapter,
  createCatalogueAdapter,
} from './off-adapter';

export { DEFAULT_EVIDENCE_VERSION, DEFAULT_TAXONOMY_VERSION } from './types';
export type {
  CatalogueConfig,
  LookupOptions,
  LookupOutcome,
  NutrientObservation,
  OffIngredientV3,
  OffProductV3,
  OffResponseV3,
  PanelRegion,
  ProductSnapshot,
  SourceRef,
} from './types';
