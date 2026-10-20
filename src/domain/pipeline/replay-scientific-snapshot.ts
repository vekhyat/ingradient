import manifestJson from '../../../resources/manifest.json';
import methodJson from '../../../resources/method/nutriscore-updated-2023.json';
import type {
  NutrientObservation,
  ProductSnapshot,
} from '../contracts/generated/local';
import {
  EVIDENCE_VERSION,
  renderScientificAssessment,
  type EvidenceResult,
} from '../evidence';
import {
  calculateNutriScore,
  type CalculationIssue,
  type DeclaredAmount,
  type FactState,
  type NutriScoreCategory,
  type NutriScoreInput,
  type NutriScoreNutrient,
  type NutriScoreRoute,
  type RefusedResult,
  type ScoringFactName,
} from '../scientific';
import { PINNED_METHOD } from '../scientific/method-bundle';

const NUTRISCORE_NUTRIENTS: readonly NutriScoreNutrient[] = [
  'energy',
  'sugars',
  'saturates',
  'salt',
  'protein',
  'fibre',
  'fat',
  'fvl',
];

const SCORING_FACT_NAMES: readonly ScoringFactName[] = [
  'cheese',
  'redMeat',
  'plainWater',
  'nonNutritiveSweetener',
];

function isRoute(category: string): category is NutriScoreRoute {
  return (
    category === 'general' ||
    category === 'fats_nuts_seeds' ||
    category === 'beverage'
  );
}

function getRouteRequiredNutrients(
  category: NutriScoreCategory,
): readonly NutriScoreNutrient[] {
  return NUTRISCORE_NUTRIENTS.filter((field) =>
    methodJson.inputFields.fields[field].routes.some(
      (route) => route === category,
    ),
  );
}

function isObservationUsable(
  obs: NutrientObservation,
  knownSourceIds: Set<string>,
): obs is Extract<NutrientObservation, { kind: 'read' | 'corrected' }> {
  if (obs.kind !== 'read' && obs.kind !== 'corrected') {
    return false;
  }
  if (obs.issues.length > 0) {
    return false;
  }
  if (obs.sourceIds.length === 0) {
    return false;
  }
  return obs.sourceIds.every((id) => knownSourceIds.has(id));
}

function pushIssue(issues: CalculationIssue[], issue: CalculationIssue): void {
  if (!issues.some((i) => i.code === issue.code && i.field === issue.field)) {
    issues.push(issue);
  }
}

/**
 * Replays a frozen ProductSnapshot into the scientific Nutri-Score calculator
 * and evidence renderer. Pure synchronous calculation with zero mutations,
 * clock, random or I/O.
 */
export function replayScientificSnapshot(
  snapshot: ProductSnapshot,
): EvidenceResult {
  if (
    snapshot.evidenceVersion !== EVIDENCE_VERSION ||
    snapshot.taxonomyVersion !==
      `off-taxonomy-ingredients@${manifestJson.revision}`
  ) {
    const issue: CalculationIssue = {
      code: 'incompatible_resources',
      stage: 'method',
      field: 'resources',
      message: 'A reviewed compatible resource bundle is unavailable.',
      action: 'read_source',
    };
    const refusal: RefusedResult = {
      state: 'method_unavailable',
      route: null,
      method: PINNED_METHOD.ok ? PINNED_METHOD.method.identity : null,
      issues: [issue],
    };
    return renderScientificAssessment(refusal, snapshot.id);
  }

  const sourceIds = new Set(snapshot.sourceRefs.map((s) => s.id));
  const categorySourceIds = snapshot.scoringFacts?.categorySourceIds;
  const supportedCategory = Boolean(
    categorySourceIds &&
    categorySourceIds.length > 0 &&
    categorySourceIds.every((id) => sourceIds.has(id)),
  );

  const statedCategory = snapshot.category;
  let effectiveCategory: NutriScoreCategory = 'unknown';
  const blockingIssues: CalculationIssue[] = [];
  const mappingIssues: CalculationIssue[] = [];

  if (
    statedCategory === 'general' ||
    statedCategory === 'fats_nuts_seeds' ||
    statedCategory === 'beverage' ||
    statedCategory === 'excluded'
  ) {
    if (supportedCategory) {
      effectiveCategory = statedCategory;
    } else {
      pushIssue(blockingIssues, {
        code: 'missing_category_provenance',
        stage: 'completeness',
        field: 'scoringFacts.categorySourceIds',
        message: 'Source evidence for the stated product category is missing.',
        action: 'add_field',
      });
      effectiveCategory = 'unknown';
    }
  } else {
    effectiveCategory = 'unknown';
  }

  const factStates: Record<ScoringFactName, FactState> = {
    cheese: 'unknown',
    redMeat: 'unknown',
    plainWater: 'unknown',
    nonNutritiveSweetener: 'unknown',
  };

  if (snapshot.scoringFacts) {
    for (const name of SCORING_FACT_NAMES) {
      const fact = snapshot.scoringFacts[name];
      if (fact && (fact.state === 'present' || fact.state === 'absent')) {
        const hasSources =
          fact.sourceIds.length > 0 &&
          fact.sourceIds.every((id) => sourceIds.has(id));
        if (hasSources) {
          factStates[name] = fact.state;
        } else {
          factStates[name] = 'unknown';
          pushIssue(mappingIssues, {
            code: 'unprovenanced_fact',
            stage: 'completeness',
            field: `scoringFacts.${name}`,
            message: `Source evidence for the ${name} fact is missing or unverified.`,
            action: 'read_source',
          });
        }
      } else {
        factStates[name] = 'unknown';
      }
    }
  }

  // Plain-water contradiction check:
  // If plain water is present on a beverage route, any non-zero nutrient observation conflicts.
  if (effectiveCategory === 'beverage' && factStates.plainWater === 'present') {
    const hasContradictoryNutrient = snapshot.observations.some(
      (obs) =>
        obs.kind !== 'missing' &&
        obs.value !== 0 &&
        NUTRISCORE_NUTRIENTS.some((field) => field === obs.field),
    );
    if (hasContradictoryNutrient) {
      pushIssue(blockingIssues, {
        code: 'conflicting_water_facts',
        stage: 'completeness',
        field: 'plainWater',
        message: 'Plain-water evidence conflicts with nutrient observations.',
        action: 'add_field',
      });
    }
  }

  // Map and validate nutrient observations for route-required fields
  const requiredNutrients =
    effectiveCategory === 'beverage' && factStates.plainWater === 'present'
      ? []
      : getRouteRequiredNutrients(effectiveCategory);
  const nutrients: Partial<Record<NutriScoreNutrient, DeclaredAmount>> = {};

  const obsByField = new Map<string, NutrientObservation[]>();
  for (const obs of snapshot.observations) {
    const list = obsByField.get(obs.field);
    if (list) {
      list.push(obs);
    } else {
      obsByField.set(obs.field, [obs]);
    }
  }

  for (const field of requiredNutrients) {
    const allFieldObs = obsByField.get(field) ?? [];
    const requiredBasis =
      effectiveCategory === 'beverage' ? 'per_100_ml' : 'per_100_g';
    // A second label column is not a competing reading of the scoring column.
    // Missing observations have no basis and still require explicit resolution.
    const matchingObs = allFieldObs.filter(
      (obs) => obs.kind === 'missing' || obs.basis === requiredBasis,
    );
    const fieldObs = matchingObs.length > 0 ? matchingObs : allFieldObs;
    if (matchingObs.length === 0 && fieldObs.length > 1) {
      pushIssue(blockingIssues, {
        code: `unsupported_${field}_basis`,
        stage: 'completeness',
        field,
        message: 'A supported unit and per-100 basis are required.',
        action: 'read_source',
      });
      continue;
    }
    if (fieldObs.length > 1) {
      pushIssue(blockingIssues, {
        code: `conflicting_${field}`,
        stage: 'completeness',
        field,
        message: 'Multiple observations require explicit resolution.',
        action: 'add_field',
      });
      for (const obs of fieldObs) {
        if (!isObservationUsable(obs, sourceIds)) {
          pushIssue(blockingIssues, {
            code: 'unusable_observation',
            stage: 'completeness',
            field,
            message:
              'An uncertain, missing or flagged observation cannot support this calculation.',
            action: 'add_field',
          });
        }
      }
    } else if (fieldObs.length === 1) {
      const obs = fieldObs[0];
      if (!obs || !isObservationUsable(obs, sourceIds)) {
        pushIssue(blockingIssues, {
          code: 'unusable_observation',
          stage: 'completeness',
          field,
          message:
            'An uncertain, missing or flagged observation cannot support this calculation.',
          action: 'add_field',
        });
      } else {
        nutrients[field] = {
          value: obs.value,
          unit: obs.unit,
          basis: obs.basis,
        };
      }
    }
  }

  // Populate any other usable Nutri-Score observations (e.g. non-required on this route)
  for (const field of NUTRISCORE_NUTRIENTS) {
    if (!requiredNutrients.includes(field) && !nutrients[field]) {
      const fieldObs = obsByField.get(field) ?? [];
      const obs = fieldObs[0];
      if (fieldObs.length === 1 && obs && isObservationUsable(obs, sourceIds)) {
        nutrients[field] = {
          value: obs.value,
          unit: obs.unit,
          basis: obs.basis,
        };
      } else if (fieldObs.length > 0) {
        pushIssue(mappingIssues, {
          code:
            fieldObs.length > 1
              ? `conflicting_${field}`
              : 'unusable_observation',
          stage: 'completeness',
          field,
          message: 'This observation cannot support the calculation.',
          action: 'edit',
        });
      }
    }
  }

  const [firstBlockingIssue, ...remainingBlockingIssues] = blockingIssues;
  if (firstBlockingIssue) {
    const refusal: RefusedResult = {
      state: 'insufficient_data',
      route: isRoute(effectiveCategory) ? effectiveCategory : null,
      method: PINNED_METHOD.ok ? PINNED_METHOD.method.identity : null,
      issues: [firstBlockingIssue, ...remainingBlockingIssues],
    };
    return {
      ...renderScientificAssessment(refusal, snapshot.id),
      issues: [...mappingIssues, ...blockingIssues],
    };
  }

  const input: NutriScoreInput = {
    category: effectiveCategory,
    facts: factStates,
    nutrients,
  };

  const result = calculateNutriScore(input);
  const rendered = renderScientificAssessment(result, snapshot.id);
  return { ...rendered, issues: [...mappingIssues, ...rendered.issues] };
}
