import type { NutritionTextFragment } from '../../domain/nutrition';
import type { LabelPanels } from './label-panels';

/**
 * One label-capture session (U04). It tracks which panels are present, not
 * how many photos were taken (D57):
 * - one photo may fill both panels and share one image id;
 * - separate photos may arrive in either order;
 * - a retake replaces only the named panel and keeps the other one;
 * - a photo with neither panel changes nothing.
 */

export type PanelName = 'ingredients' | 'nutrition';

export type PanelState =
  'read' | 'uncertain' | 'missing' | 'user_marked_absent';

export interface SessionPhoto {
  imageId: string;
  uri: string;
}

export interface IngredientsPanel {
  state: PanelState;
  imageId: string | null;
  text: string | null;
}

export interface NutritionPanel {
  state: PanelState;
  imageId: string | null;
  fragments: NutritionTextFragment[];
}

export interface LabelSession {
  id: string;
  /** Barcode and Open Food Facts record when the label fills a lookup gap. */
  barcode: string | null;
  photos: SessionPhoto[];
  ingredients: IngredientsPanel;
  nutrition: NutritionPanel;
}

export type PhotoOutcome =
  | { kind: 'filled'; panels: PanelName[] }
  | { kind: 'neither' }
  | { kind: 'already_present'; panels: PanelName[] };

export function createLabelSession(
  id: string,
  barcode: string | null,
  /**
   * Panels an earlier record already supplies (for example an Open Food
   * Facts product with ingredients but no table). They count as present, so
   * a photo only fills what is still missing; the facts stay on that record.
   */
  alreadyPresent: { ingredients?: boolean; nutrition?: boolean } = {},
): LabelSession {
  return {
    id,
    barcode,
    photos: [],
    ingredients: {
      state: alreadyPresent.ingredients ? 'read' : 'missing',
      imageId: null,
      text: null,
    },
    nutrition: {
      state: alreadyPresent.nutrition ? 'read' : 'missing',
      imageId: null,
      fragments: [],
    },
  };
}

function open(state: PanelState): boolean {
  return state === 'missing';
}

/**
 * Applies one photo's panels. `retake` names the only panel this photo may
 * replace. Returns the new session, what happened, and the URIs of photos
 * no panel uses any more (the caller deletes them).
 */
export function applyPhoto(
  session: LabelSession,
  photo: SessionPhoto,
  found: LabelPanels,
  retake: PanelName | null,
): { session: LabelSession; outcome: PhotoOutcome; orphanedUris: string[] } {
  const hasIngredients = found.ingredientsText !== null;
  const hasNutrition = found.nutritionFragments.length > 0;

  let ingredients = session.ingredients;
  let nutrition = session.nutrition;
  const filled: PanelName[] = [];
  const present: PanelName[] = [];

  const mayFill = (panel: PanelName, state: PanelState) =>
    retake === null ? open(state) : retake === panel;

  if (hasIngredients) {
    if (mayFill('ingredients', ingredients.state)) {
      ingredients = {
        state: 'read',
        imageId: photo.imageId,
        text: found.ingredientsText,
      };
      filled.push('ingredients');
    } else {
      present.push('ingredients');
    }
  }
  if (hasNutrition) {
    if (mayFill('nutrition', nutrition.state)) {
      nutrition = {
        state: 'read',
        imageId: photo.imageId,
        fragments: found.nutritionFragments,
      };
      filled.push('nutrition');
    } else {
      present.push('nutrition');
    }
  }

  if (filled.length === 0) {
    return {
      session,
      outcome:
        present.length > 0
          ? { kind: 'already_present', panels: present }
          : { kind: 'neither' },
      orphanedUris: [photo.uri],
    };
  }

  const next: LabelSession = {
    ...session,
    photos: [...session.photos, photo],
    ingredients,
    nutrition,
  };
  const pruned = pruneUnusedPhotos(next);
  return {
    session: pruned.session,
    outcome: { kind: 'filled', panels: filled },
    orphanedUris: pruned.orphanedUris,
  };
}

function pruneUnusedPhotos(session: LabelSession): {
  session: LabelSession;
  orphanedUris: string[];
} {
  const inUse = new Set(
    [session.ingredients.imageId, session.nutrition.imageId].filter(
      (id): id is string => id !== null,
    ),
  );
  const keep = session.photos.filter((photo) => inUse.has(photo.imageId));
  const orphanedUris = session.photos
    .filter((photo) => !inUse.has(photo.imageId))
    .map((photo) => photo.uri);
  return { session: { ...session, photos: keep }, orphanedUris };
}

/** The user says this pack has no such panel (for example no table). */
export function markPanelAbsent(
  session: LabelSession,
  panel: PanelName,
): { session: LabelSession; orphanedUris: string[] } {
  const next: LabelSession =
    panel === 'ingredients'
      ? {
          ...session,
          ingredients: {
            state: 'user_marked_absent',
            imageId: null,
            text: null,
          },
        }
      : {
          ...session,
          nutrition: {
            state: 'user_marked_absent',
            imageId: null,
            fragments: [],
          },
        };
  return pruneUnusedPhotos(next);
}

/** Ready for review when each panel is present or explicitly absent. */
/**
 * Ingredients first (D131): an ingredient list alone is enough to show
 * results; the nutrition table is an optional add-on. A nutrition table
 * alone needs the ingredients, or the user saying the pack has none.
 */
export function isReadyForReview(session: LabelSession): boolean {
  const present = (state: PanelState) =>
    state === 'read' || state === 'uncertain';
  if (present(session.ingredients.state)) {
    return true;
  }
  return (
    session.ingredients.state === 'user_marked_absent' &&
    session.nutrition.state !== 'missing'
  );
}

/** True when ingredients are in but the optional nutrition table is not. */
export function nutritionStillOptional(session: LabelSession): boolean {
  return isReadyForReview(session) && session.nutrition.state === 'missing';
}

export function missingPanels(session: LabelSession): PanelName[] {
  const result: PanelName[] = [];
  if (session.ingredients.state === 'missing') {
    result.push('ingredients');
  }
  if (session.nutrition.state === 'missing') {
    result.push('nutrition');
  }
  return result;
}
