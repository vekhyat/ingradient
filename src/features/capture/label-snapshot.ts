import type {
  IngredientMention,
  Issue,
  NutrientObservation,
  PanelRegion,
  ProductSnapshot,
  SourceRef,
} from '../../domain/contracts/generated/local';
import {
  parseIngredients,
  toExtractionIssues,
  toIngredientMentions,
} from '../../domain/ingredients';
import { parseNutritionTable } from '../../domain/nutrition';
import {
  DEFAULT_EVIDENCE_VERSION,
  DEFAULT_TAXONOMY_VERSION,
} from '../../adapters/catalogue/types';
import type { LabelSession, PanelState } from './label-session';

/**
 * Builds the product record from a label session plus the user's
 * corrections. Corrections change the transcription and keep the original
 * source id, so "You corrected this transcription" can always be shown.
 */

export type NutrientCorrection =
  | { kind: 'value'; value: number; unit: 'g' | 'kJ' | 'percent'; basis: Basis }
  | { kind: 'unreadable' };

export type IngredientCorrection =
  { kind: 'text'; text: string } | { kind: 'unreadable' };

type Basis = 'per_100_g' | 'per_100_ml' | 'per_serving';

export interface Corrections {
  ingredients: Record<string, IngredientCorrection>;
  nutrients: Record<string, NutrientCorrection>;
}

export const NO_CORRECTIONS: Corrections = { ingredients: {}, nutrients: {} };

/** Fields shown in review even when the photo had no row for them. */
export const REVIEW_FIELDS = [
  'energy',
  'fat',
  'saturates',
  'sugars',
  'fibre',
  'protein',
  'salt',
] as const;

export interface LabelBuildInput {
  session: LabelSession;
  corrections: Corrections;
  capturedAt: string;
  /** Open Food Facts record being completed by the label, if any. */
  base: ProductSnapshot | null;
}

function panelRegion(
  panel: 'ingredients' | 'nutrition',
  state: PanelState,
  imageId: string | null,
  text: string | undefined,
  issues: Issue[],
): PanelRegion {
  return {
    panel,
    state,
    imageId,
    regionId: imageId ? `${imageId}:${panel}` : null,
    ...(text !== undefined ? { text } : {}),
    issues,
  };
}

export function buildLabelSnapshot({
  session,
  corrections,
  capturedAt,
  base,
}: LabelBuildInput): ProductSnapshot {
  const sourceRefs: SourceRef[] = base ? [...base.sourceRefs] : [];
  let nextSource = 0;
  const newSourceId = () => {
    let id: string;
    do {
      id = `src-${nextSource++}`;
    } while (sourceRefs.some((ref) => ref.id === id));
    return id;
  };

  // Ingredients.
  let ingredients: IngredientMention[] = base ? [...base.ingredients] : [];
  let ingredientsPanel: PanelRegion | undefined = base?.panels.find(
    (panel) => panel.panel === 'ingredients',
  );
  if (session.ingredients.state === 'user_marked_absent') {
    ingredients = [];
    ingredientsPanel = panelRegion(
      'ingredients',
      'user_marked_absent',
      null,
      undefined,
      [],
    );
  } else if (session.ingredients.text !== null) {
    const labelId = newSourceId();
    sourceRefs.push({
      id: labelId,
      kind: 'label',
      title: 'Ingredients on your label photo',
    });
    const parsed = parseIngredients(session.ingredients.text);
    const issues = toExtractionIssues(parsed);
    ingredients = toIngredientMentions(parsed, {
      sourceIds: [labelId],
      taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
    }).mentions;
    ingredientsPanel = panelRegion(
      'ingredients',
      issues.length > 0 ? 'uncertain' : 'read',
      session.ingredients.imageId,
      session.ingredients.text,
      issues,
    );
  }

  // Apply ingredient corrections.
  const correctionRefs = new Map<string, string>();
  const correctionSource = (title: string) => {
    const existing = correctionRefs.get(title);
    if (existing) {
      return existing;
    }
    const id = newSourceId();
    sourceRefs.push({ id, kind: 'user_correction', title });
    correctionRefs.set(title, id);
    return id;
  };
  ingredients = ingredients.map((mention) => {
    const fix = corrections.ingredients[mention.id];
    if (!fix || fix.kind !== 'text' || fix.text.trim().length === 0) {
      return mention;
    }
    const fixId = correctionSource('Your correction');
    return {
      ...mention,
      text: fix.text.trim(),
      canonicalId: null,
      state: 'unresolved',
      candidateIds: [],
      sourceIds: [fixId, ...mention.sourceIds],
    };
  });

  // Nutrition.
  let observations: NutrientObservation[] = base ? [...base.observations] : [];
  let nutritionPanel: PanelRegion | undefined = base?.panels.find(
    (panel) => panel.panel === 'nutrition',
  );
  if (session.nutrition.state === 'user_marked_absent') {
    observations = [];
    nutritionPanel = panelRegion(
      'nutrition',
      'user_marked_absent',
      null,
      undefined,
      [],
    );
  } else if (session.nutrition.fragments.length > 0) {
    const ids = session.nutrition.fragments.map(() => newSourceId());
    session.nutrition.fragments.forEach((fragment, index) => {
      sourceRefs.push({
        id: ids[index] ?? newSourceId(),
        kind: 'label',
        title: 'Nutrition table on your label photo',
        locator: fragment.text,
      });
    });
    const parsed = parseNutritionTable(session.nutrition.fragments, {
      sourceIds: ids,
    });
    observations = parsed.observations as NutrientObservation[];
    const uncertain =
      parsed.issues.length > 0 ||
      observations.some((observation) => observation.kind === 'uncertain');
    nutritionPanel = panelRegion(
      'nutrition',
      observations.length === 0 ? 'missing' : uncertain ? 'uncertain' : 'read',
      session.nutrition.imageId,
      session.nutrition.fragments.map((fragment) => fragment.text).join('\n'),
      parsed.issues,
    );
  }

  // Missing review fields stay missing; a missing row is not zero.
  for (const field of REVIEW_FIELDS) {
    if (!observations.some((observation) => observation.field === field)) {
      observations.push({
        field,
        kind: 'missing',
        reason: 'not_available',
        issues: [],
      });
    }
  }

  // Apply nutrient corrections.
  observations = observations.map((observation): NutrientObservation => {
    const fix = corrections.nutrients[observation.field];
    if (!fix) {
      return observation;
    }
    if (fix.kind === 'unreadable') {
      return {
        field: observation.field,
        kind: 'missing',
        reason: 'unreadable',
        issues: [],
      };
    }
    const fixId = correctionSource('Your correction');
    const previous =
      observation.kind === 'missing' ? [fixId] : observation.sourceIds;
    return {
      field: observation.field,
      kind: 'corrected',
      value: fix.value,
      unit: fix.unit,
      basis: fix.basis,
      sourceIds: [fixId],
      previousSourceIds: [previous[0] ?? fixId, ...previous.slice(1)],
      issues: [],
    };
  });

  const panels: PanelRegion[] = [];
  panels.push(
    ingredientsPanel ??
      panelRegion('ingredients', 'missing', null, undefined, []),
  );
  panels.push(
    nutritionPanel ?? panelRegion('nutrition', 'missing', null, undefined, []),
  );

  return {
    id: base ? `${base.id}+label:${session.id}` : `label:${session.id}`,
    barcode: base?.barcode ?? session.barcode,
    name: base?.name ?? null,
    market: base?.market ?? 'unknown',
    capturedAt,
    sourceRefs,
    observations,
    ingredients,
    panels,
    category: base?.category ?? 'unknown',
    taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
    evidenceVersion: base?.evidenceVersion ?? DEFAULT_EVIDENCE_VERSION,
  };
}
