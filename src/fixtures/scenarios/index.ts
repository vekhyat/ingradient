import { buildCancelledScanScenario } from './cancelled-scan';
import { buildCompleteGradedScenario } from './complete-graded';
import { buildConflictingSourcesScenario } from './conflicting-sources';
import { buildMissingNutrientsScenario } from './missing-nutrients';
import { buildThrottledLookupScenario } from './throttled-lookup';
import type { LocalScenario, LocalScenarioName, LookupOutcome } from './types';
import { buildUnsupportedCategoryScenario } from './unsupported-category';

export type { LocalScenario, LocalScenarioName, LookupOutcome };
export {
  buildCancelledScanScenario,
  buildCompleteGradedScenario,
  buildConflictingSourcesScenario,
  buildMissingNutrientsScenario,
  buildThrottledLookupScenario,
  buildUnsupportedCategoryScenario,
};

export const namedLocalScenarios: Record<LocalScenarioName, LocalScenario> = {
  complete_graded: buildCompleteGradedScenario(),
  missing_nutrients: buildMissingNutrientsScenario(),
  unsupported_category: buildUnsupportedCategoryScenario(),
  conflicting_sources: buildConflictingSourcesScenario(),
  throttled_lookup: buildThrottledLookupScenario(),
  cancelled_scan: buildCancelledScanScenario(),
};

export function getLocalScenario(name: LocalScenarioName): LocalScenario {
  const scenario = namedLocalScenarios[name];
  if (!scenario) {
    throw new Error(`Unknown local scenario: ${String(name)}`);
  }
  return scenario;
}
