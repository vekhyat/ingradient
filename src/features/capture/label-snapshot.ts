import type {
  IngredientMention,
  Issue,
  NutrientObservation,
  PanelRegion,
  PresenceFact,
  ProductSnapshot,
  ScoringFacts,
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
  const unreadableIssues: Issue[] = [];
  ingredients = ingredients.map((mention) => {
    const fix = corrections.ingredients[mention.id];
    if (fix?.kind === 'unreadable') {
      // The printed text stays as evidence of what was rejected; the issue
      // and the dropped identity say it cannot be relied on.
      unreadableIssues.push(unreadableIngredientIssue(mention));
      return {
        ...mention,
        canonicalId: null,
        state: 'unresolved',
        candidateIds: [],
        sourceIds: [
          correctionSource('You marked this as unreadable'),
          ...mention.sourceIds,
        ],
      };
    }
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

  if (unreadableIssues.length > 0) {
    const panel =
      ingredientsPanel ??
      panelRegion('ingredients', 'uncertain', null, undefined, []);
    ingredientsPanel = {
      ...panel,
      state: 'uncertain',
      issues: [...panel.issues, ...unreadableIssues],
    };
  }

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

  const scoringFacts = base?.scoringFacts
    ? keptScoringFacts(
        base.scoringFacts,
        new Set(sourceRefs.map((ref) => ref.id)),
        session.ingredients.state === 'user_marked_absent' ||
          session.ingredients.text !== null,
      )
    : undefined;

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
    ...(scoringFacts ? { scoringFacts } : {}),
    taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
    evidenceVersion: base?.evidenceVersion ?? DEFAULT_EVIDENCE_VERSION,
  };
}

/** Marks one rejected reading; `field` names the mention it applies to. */
function unreadableIngredientIssue(mention: IngredientMention): Issue {
  return {
    code: 'ingredient_unreadable',
    stage: 'extraction',
    field: `ingredients.${mention.id}`,
    message: `You marked "${mention.text}" as unreadable.`,
    action: 'retake',
  };
}

const UNKNOWN_FACT: PresenceFact = { state: 'unknown' };

/**
 * The earlier record's scoring facts (ADR013) still describe the product
 * when a label only adds panels: category, cheese, red meat and water come
 * from its category tags, which the label does not change. A sweetener fact
 * comes from that record's ingredient list, so it is not kept once the label
 * replaces the list; a water absence it implied goes with it. Returns
 * undefined when nothing known remains (omission means unknown).
 */
function keptScoringFacts(
  facts: ScoringFacts,
  sourceIds: ReadonlySet<string>,
  ingredientsReplaced: boolean,
): ScoringFacts | undefined {
  const sourced = (fact: PresenceFact): PresenceFact =>
    fact.state === 'unknown' || fact.sourceIds.every((id) => sourceIds.has(id))
      ? fact
      : UNKNOWN_FACT;
  const sweetenerPresent = facts.nonNutritiveSweetener.state === 'present';
  const kept: ScoringFacts = {
    categorySourceIds: facts.categorySourceIds.every((id) => sourceIds.has(id))
      ? [...facts.categorySourceIds]
      : [],
    cheese: sourced(facts.cheese),
    redMeat: sourced(facts.redMeat),
    plainWater:
      ingredientsReplaced &&
      sweetenerPresent &&
      facts.plainWater.state === 'absent'
        ? UNKNOWN_FACT
        : sourced(facts.plainWater),
    nonNutritiveSweetener: ingredientsReplaced
      ? UNKNOWN_FACT
      : sourced(facts.nonNutritiveSweetener),
  };
  const anything =
    kept.categorySourceIds.length > 0 ||
    [
      kept.cheese,
      kept.redMeat,
      kept.plainWater,
      kept.nonNutritiveSweetener,
    ].some((fact) => fact.state !== 'unknown');
  return anything ? kept : undefined;
}
