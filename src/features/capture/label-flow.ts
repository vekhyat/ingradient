import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { splitLabelPanels } from './label-panels';
import {
  applyPhoto,
  createLabelSession,
  markPanelAbsent,
  type LabelSession,
  type PanelName,
  type PhotoOutcome,
} from './label-session';
import {
  NO_CORRECTIONS,
  buildLabelSnapshot,
  type Corrections,
  type IngredientCorrection,
  type NutrientCorrection,
} from './label-snapshot';
import type { OcrOutcome } from './ocr-page';

/**
 * The label journey's state (U04–U07): photos → panels → review with
 * corrections → a product snapshot. Photos are deleted as soon as no panel
 * uses them, and all of them on discard or after analysis.
 */

export type ReadOutcome =
  | PhotoOutcome
  | { kind: 'no_text' }
  | { kind: 'unsupported_language' }
  | { kind: 'engine_error' }
  | { kind: 'capture_failed' };

export interface LabelFlowState {
  session: LabelSession | null;
  base: ProductSnapshot | null;
  corrections: Corrections;
  retake: PanelName | null;
  reading: boolean;
  lastOutcome: ReadOutcome | null;
}

export interface LabelFlowDeps {
  recognise: (uri: string) => Promise<OcrOutcome>;
  adoptPhoto: (uri: string) => Promise<string>;
  deletePhoto: (uri: string) => void;
  newId: () => string;
}

const EMPTY: LabelFlowState = {
  session: null,
  base: null,
  corrections: NO_CORRECTIONS,
  retake: null,
  reading: false,
  lastOutcome: null,
};

export class LabelFlow {
  private state: LabelFlowState = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readToken = 0;

  constructor(private readonly deps: LabelFlowDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = () => this.state;

  private set(next: Partial<LabelFlowState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** Starts a fresh session, discarding any earlier one. */
  start(base: ProductSnapshot | null): void {
    this.discard();
    const panelHasFacts = (panel: 'ingredients' | 'nutrition') =>
      base?.panels.some(
        (p) =>
          p.panel === panel && (p.state === 'read' || p.state === 'uncertain'),
      ) ?? false;
    this.set({
      session: createLabelSession(this.deps.newId(), base?.barcode ?? null, {
        ingredients: panelHasFacts('ingredients'),
        nutrition:
          panelHasFacts('nutrition') &&
          (base?.observations.some((o) => o.kind !== 'missing') ?? false),
      }),
      base,
    });
  }

  ensureStarted(): void {
    if (!this.state.session) {
      this.start(null);
    }
  }

  setRetake(panel: PanelName | null): void {
    this.set({ retake: panel, lastOutcome: null });
  }

  /** Reads one photo. Late results from a discarded session are dropped. */
  async addPhoto(rawUri: string): Promise<ReadOutcome> {
    const session = this.state.session;
    if (!session) {
      this.deps.deletePhoto(rawUri);
      return { kind: 'capture_failed' };
    }
    const token = ++this.readToken;
    this.set({ reading: true, lastOutcome: null });
    let uri: string;
    try {
      uri = await this.deps.adoptPhoto(rawUri);
    } catch {
      this.deps.deletePhoto(rawUri);
      return this.finishRead(token, { kind: 'capture_failed' });
    }
    if (token !== this.readToken || this.state.session?.id !== session.id) {
      this.deps.deletePhoto(uri);
      return { kind: 'capture_failed' };
    }
    let ocr: OcrOutcome;
    try {
      ocr = await this.deps.recognise(uri);
    } catch {
      this.deps.deletePhoto(uri);
      return this.finishRead(token, { kind: 'engine_error' });
    }
    if (token !== this.readToken || this.state.session?.id !== session.id) {
      this.deps.deletePhoto(uri);
      return { kind: 'capture_failed' };
    }
    if (ocr.status !== 'read') {
      this.deps.deletePhoto(uri);
      return this.finishRead(token, { kind: ocr.status });
    }
    const current = this.state.session;
    const result = applyPhoto(
      current,
      { imageId: this.deps.newId(), uri },
      splitLabelPanels(ocr.page),
      this.state.retake,
    );
    for (const orphan of result.orphanedUris) {
      this.deps.deletePhoto(orphan);
    }
    this.set({
      session: result.session,
      retake: result.outcome.kind === 'filled' ? null : this.state.retake,
    });
    return this.finishRead(token, result.outcome);
  }

  private finishRead(token: number, outcome: ReadOutcome): ReadOutcome {
    if (token === this.readToken) {
      this.set({ reading: false, lastOutcome: outcome });
    }
    return outcome;
  }

  markAbsent(panel: PanelName): void {
    const session = this.state.session;
    if (!session) {
      return;
    }
    const result = markPanelAbsent(session, panel);
    for (const orphan of result.orphanedUris) {
      this.deps.deletePhoto(orphan);
    }
    this.set({ session: result.session });
  }

  correctIngredient(id: string, correction: IngredientCorrection): void {
    this.set({
      corrections: {
        ...this.state.corrections,
        ingredients: {
          ...this.state.corrections.ingredients,
          [id]: correction,
        },
      },
    });
  }

  correctNutrient(field: string, correction: NutrientCorrection): void {
    this.set({
      corrections: {
        ...this.state.corrections,
        nutrients: { ...this.state.corrections.nutrients, [field]: correction },
      },
    });
  }

  buildSnapshot(capturedAt: string): ProductSnapshot | null {
    const { session, corrections, base } = this.state;
    if (!session) {
      return null;
    }
    return buildLabelSnapshot({ session, corrections, capturedAt, base });
  }

  /** Deletes every session photo and clears the journey. */
  discard(): void {
    this.readToken += 1;
    for (const photo of this.state.session?.photos ?? []) {
      this.deps.deletePhoto(photo.uri);
    }
    this.state = EMPTY;
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** True when there is anything the user would lose by leaving. */
  isDirty(): boolean {
    return hasUnsavedLabelWork(this.state);
  }
}

/**
 * Work the user would lose by leaving: a photo, a panel they marked as not
 * on the pack, or a correction. Panels an earlier record supplied are not
 * the user's work, so a fresh "add the nutrition table" session is clean.
 */
export function hasUnsavedLabelWork(state: LabelFlowState): boolean {
  const { session, corrections } = state;
  if (!session) {
    return false;
  }
  return (
    session.photos.length > 0 ||
    session.ingredients.state === 'user_marked_absent' ||
    session.nutrition.state === 'user_marked_absent' ||
    Object.keys(corrections.ingredients).length > 0 ||
    Object.keys(corrections.nutrients).length > 0
  );
}
