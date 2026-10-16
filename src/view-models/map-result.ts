import type {
  Citation,
  IngredientMention,
  LocalAssessment,
  LookupOutcome,
  NutrientObservation,
  ProductSnapshot,
  ScientificAssessment,
  SourceRef,
} from '../domain/contracts/generated/local';
import type {
  AmountView,
  AnalysisExecutor,
  CitationView,
  DataCredit,
  FactKind,
  IngredientOccurrence,
  LocalProductView,
  LookupFailure,
  PanelPresence,
  ResultView,
  ScientificView,
} from './types';

/** Display labels for the frozen nutrient field names. */
export const NUTRIENT_LABELS: Record<string, string> = {
  energy: 'Energy',
  fat: 'Fat',
  saturates: 'Saturated fat',
  sugars: 'Total sugars',
  added_sugars: 'Added sugars',
  fibre: 'Fibre',
  protein: 'Protein',
  salt: 'Salt',
  sodium: 'Sodium',
  fvl: 'Fruit, vegetables and legumes',
};

/** Fixed reading order for the nutrition table. Unknown fields go last. */
const NUTRIENT_ORDER = [
  'energy',
  'fat',
  'saturates',
  'sugars',
  'added_sugars',
  'fibre',
  'protein',
  'salt',
  'sodium',
  'fvl',
];

export const BASIS_LABELS: Record<string, string> = {
  per_100_g: 'per 100 g',
  per_100_ml: 'per 100 ml',
  per_serving: 'per serving',
};

const MISSING_REASON_TEXT: Record<string, string> = {
  not_declared: 'Not on the label',
  unreadable: 'Could not be read',
  ambiguous: 'Unclear on the label',
  unsupported_basis: 'Given in a unit or basis the app cannot use',
  conflicting_sources: 'Sources disagree',
  not_available: 'Not available',
};

const CATEGORY_LABELS: Record<ProductSnapshot['category'], string | null> = {
  general: null,
  fats_nuts_seeds: 'Fats, nuts and seeds',
  beverage: 'Drink',
  excluded: null,
  unknown: null,
};

function sourceKindById(snapshot: ProductSnapshot): Map<string, SourceRef> {
  return new Map(snapshot.sourceRefs.map((ref) => [ref.id, ref]));
}

function originOf(
  sourceIds: readonly string[],
  sources: Map<string, SourceRef>,
): 'off' | 'ocr' {
  for (const id of sourceIds) {
    if (sources.get(id)?.kind === 'off') {
      return 'off';
    }
  }
  return 'ocr';
}

function hasCorrection(
  sourceIds: readonly string[],
  sources: Map<string, SourceRef>,
): boolean {
  return sourceIds.some((id) => sources.get(id)?.kind === 'user_correction');
}

export function dataCreditOf(snapshot: ProductSnapshot): DataCredit {
  const kinds = new Set(snapshot.sourceRefs.map((ref) => ref.kind));
  const off = kinds.has('off');
  const label = kinds.has('label') || kinds.has('user_correction');
  if (off && label) {
    return 'mixed';
  }
  return off ? 'off' : 'label_photo';
}

export function toProductView(snapshot: ProductSnapshot): LocalProductView {
  return {
    productId: snapshot.id,
    barcode: snapshot.barcode,
    name:
      snapshot.name && snapshot.name.trim().length > 0 ? snapshot.name : null,
    brand: null,
    sizeText: null,
    image: { source: 'none' },
    retrievedAt: snapshot.capturedAt,
    dataCredit: dataCreditOf(snapshot),
    categoryLabel: CATEGORY_LABELS[snapshot.category],
  };
}

export function toIngredientOccurrences(
  snapshot: ProductSnapshot,
): IngredientOccurrence[] {
  const sources = sourceKindById(snapshot);
  const depthById = new Map<string, number>();
  return snapshot.ingredients.map((mention: IngredientMention, index) => {
    const parentDepth =
      mention.parentId === null ? -1 : (depthById.get(mention.parentId) ?? -1);
    const depth = parentDepth + 1;
    depthById.set(mention.id, depth);
    const origin = originOf(mention.sourceIds, sources);
    const kind: FactKind = hasCorrection(mention.sourceIds, sources)
      ? { kind: 'corrected', origin: 'user_correction', previous: origin }
      : { kind: 'read', origin };
    return {
      occurrenceId: mention.id,
      packOrder: index + 1,
      printedText: mention.text,
      canonicalId: mention.canonicalId,
      match: mention.state,
      kind,
      nestedIn: mention.parentId,
      depth,
    };
  });
}

export function toAmountView(
  observation: NutrientObservation,
  sources: Map<string, SourceRef>,
): AmountView {
  const label = NUTRIENT_LABELS[observation.field] ?? observation.field;
  if (observation.kind === 'missing') {
    return {
      field: observation.field,
      label,
      value: null,
      unit: '',
      basis: '',
      kind: null,
      missingReason: MISSING_REASON_TEXT[observation.reason] ?? 'Not available',
    };
  }
  const origin = originOf(observation.sourceIds, sources);
  let kind: FactKind;
  switch (observation.kind) {
    case 'read':
      kind = { kind: 'read', origin };
      break;
    case 'uncertain':
      kind = {
        kind: 'uncertain',
        origin,
        cause: observation.issues[0]?.message ?? 'The value may be misread.',
      };
      break;
    case 'corrected':
      kind = {
        kind: 'corrected',
        origin: 'user_correction',
        previous: originOf(observation.previousSourceIds, sources),
      };
      break;
    case 'estimated':
      kind = {
        kind: 'estimated',
        origin: 'model_estimate',
        modelId: observation.modelId,
        modelVersion: observation.modelVersion,
      };
      break;
  }
  return {
    field: observation.field,
    label,
    value: observation.value,
    unit: observation.unit === 'percent' ? '%' : observation.unit,
    basis: BASIS_LABELS[observation.basis] ?? observation.basis,
    kind,
    missingReason: null,
  };
}

export function toNutrientViews(snapshot: ProductSnapshot): AmountView[] {
  const sources = sourceKindById(snapshot);
  const rank = (field: string) => {
    const index = NUTRIENT_ORDER.indexOf(field);
    return index === -1 ? NUTRIENT_ORDER.length : index;
  };
  return snapshot.observations
    .map((observation) => toAmountView(observation, sources))
    .sort((a, b) => rank(a.field) - rank(b.field));
}

export function toPanelPresence(snapshot: ProductSnapshot): PanelPresence[] {
  return snapshot.panels.map((panel) => ({
    panel: panel.panel,
    state: panel.state,
    imageId: panel.imageId,
  }));
}

/** One mapper from the domain contract to the UI status (BE-06). */
export function toScientificView(
  assessment: ScientificAssessment,
): ScientificView {
  if (assessment.state === 'graded') {
    return {
      status: 'supported',
      letter: assessment.grade,
      methodId: assessment.method.id,
      methodVersion: assessment.method.edition,
      reasonIds: assessment.reasons.map((reason) => reason.id),
    };
  }
  const gaps = assessment.issues.map((issue) => issue.message);
  switch (assessment.state) {
    case 'insufficient_data':
      return { status: 'insufficient_data', gaps };
    case 'method_unavailable':
      return { status: 'method_unavailable', gaps };
    case 'unsupported':
      return {
        status: 'unsupported',
        reason: assessment.issues.some((issue) => issue.stage === 'method')
          ? 'method'
          : 'category',
        detail: gaps[0] ?? 'This kind of product is not graded.',
      };
  }
}

function toCitationView(citation: Citation): CitationView {
  return {
    id: citation.id,
    title: citation.title,
    issuer: citation.issuer,
    edition: citation.edition,
    locator: citation.locator,
    claim: citation.claimScope,
    url: /^https?:\/\//.test(citation.url) ? citation.url : null,
  };
}

export interface ResultSource {
  snapshot: ProductSnapshot;
  assessment: LocalAssessment;
  executor: AnalysisExecutor | null;
  analysedAt: string | null;
}

export function toResultView({
  snapshot,
  assessment,
  executor,
  analysedAt,
}: ResultSource): ResultView {
  const science = toScientificView(assessment.scientific);
  const scientific = assessment.scientific;
  const reasons = scientific.reasons.map((reason) => ({
    id: reason.id,
    text: reason.text,
    citationIds: [...reason.citationIds],
    inputText: reason.inputFields
      .map((field) => NUTRIENT_LABELS[field] ?? field)
      .join(', '),
  }));
  const citations: Record<string, CitationView> = {};
  for (const citation of assessment.citations) {
    citations[citation.id] = toCitationView(citation);
  }
  const method =
    scientific.state === 'graded'
      ? {
          id: scientific.method.id,
          edition: scientific.method.edition,
          label: scientific.method.label,
        }
      : null;
  return {
    resultKey: `${snapshot.id}@${analysedAt ?? snapshot.capturedAt}`,
    product: toProductView(snapshot),
    science,
    personal: { status: 'not_in_slice' },
    summary: science.status === 'supported' ? (reasons[0]?.text ?? null) : null,
    reasons,
    citations,
    ingredients: toIngredientOccurrences(snapshot),
    nutrients: toNutrientViews(snapshot),
    panels: toPanelPresence(snapshot),
    method,
    executor,
    analysedAt,
  };
}

/**
 * U-AUTO-A: open Result without a confirm tap when the outcome is a grade or
 * a named gap that a label photo cannot fix. Stay on lookup for
 * insufficient_data so the user can photograph the missing panel.
 *
 * method_unavailable opens Result: no photo can supply a missing method, and
 * the result still shows the product facts. (Lead decision recorded with
 * this build; 00-local-views predates the method_unavailable state.)
 */
export function opensResultAutomatically(view: ScientificView): boolean {
  return view.status !== 'insufficient_data';
}

export function toLookupFailure(
  outcome: Exclude<LookupOutcome, { state: 'found' }>,
): LookupFailure {
  switch (outcome.state) {
    case 'invalid':
      return { status: 'invalid_code' };
    case 'throttled':
      return {
        status: 'throttled',
        retryAfterSeconds: outcome.retryAfterSeconds ?? null,
      };
    default:
      return { status: outcome.state };
  }
}
