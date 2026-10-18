import type {
  Issue,
  LocalAssessment,
  LookupOutcome,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';
import {
  issueGaps,
  opensResultAutomatically,
  toLookupFailure,
  toScientificView,
} from '../../view-models/map-result';
import type { LookupFailure } from '../../view-models/types';
import type { AnalysisUpdate, ProductAnalyser } from './analyser';

/**
 * In-memory state for one app session: the current lookup, and the results
 * produced in this session. Nothing here is persisted; saving is an
 * explicit action that goes through the encrypted store.
 *
 * Every operation has an id. A completion whose id is no longer current
 * (cancelled, superseded, or the user left) is dropped, so a late answer
 * can never open or overwrite a result (INTERACTIONS.md §2).
 */

export interface StoredResult {
  resultKey: string;
  snapshot: ProductSnapshot;
  assessment: LocalAssessment;
  executor: 'phone' | 'backend' | null;
  analysedAt: string;
  origin: 'new' | 'history';
  savedId: string | null;
  /** D70: an eligible later backend result, offered but never applied. */
  pendingUpdate: PendingUpdate | null;
  /** Set on a result opened from an update: the result it was offered on. */
  updateOf: string | null;
  /** Why the phone answered instead of the backend (HYB-01), if not timing. */
  fallbackIssue: Issue | null;
}

export interface PendingUpdate {
  assessment: LocalAssessment;
  executor: 'backend';
  introducesHardFinding: boolean;
  /** False when the grade (or the named gap) is the same as on screen. */
  differsFromDisplayed: boolean;
}

/** Same headline: same state and, when graded, the same letter. */
function sameHeadline(a: LocalAssessment, b: LocalAssessment): boolean {
  const left = toScientificView(a.scientific);
  const right = toScientificView(b.scientific);
  if (left.status !== right.status) {
    return false;
  }
  return (
    left.status !== 'supported' ||
    (right.status === 'supported' && left.letter === right.letter)
  );
}

export type LookupState =
  | { status: 'idle' }
  | {
      status: 'pending';
      operationId: string;
      barcode: string;
      stage: 'lookup' | 'analysis';
    }
  | {
      status: 'failed';
      operationId: string;
      barcode: string;
      failure: LookupFailure;
    }
  | {
      status: 'incomplete';
      operationId: string;
      barcode: string;
      base: ProductSnapshot;
      gaps: string[];
    }
  | {
      status: 'opened';
      operationId: string;
      barcode: string;
      resultKey: string;
    };

export interface CatalogueLookup {
  lookupBarcode(
    barcode: string,
    options: { signal: AbortSignal },
  ): Promise<LookupOutcome>;
}

export interface ScanSessionState {
  lookup: LookupState;
  results: Readonly<Record<string, StoredResult>>;
}

type Listener = () => void;

let counter = 0;
export function newOperationId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export class ScanSession {
  private state: ScanSessionState = { lookup: { status: 'idle' }, results: {} };
  private readonly listeners = new Set<Listener>();
  private controller: AbortController | null = null;
  /** Bumped when offers are dropped; older late updates are then ignored. */
  private updateEpoch = 0;

  constructor(
    private readonly catalogue: CatalogueLookup,
    private readonly analyser: ProductAnalyser,
    private readonly now: () => Date = () => new Date(),
  ) {}

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): ScanSessionState => this.state;

  private set(next: Partial<ScanSessionState>) {
    this.state = { ...this.state, ...next };
    for (const listener of this.listeners) {
      listener();
    }
  }

  private isCurrent(operationId: string): boolean {
    const lookup = this.state.lookup;
    return lookup.status !== 'idle' && lookup.operationId === operationId;
  }

  /** Starts one lookup. An earlier pending lookup is cancelled first. */
  async lookup(barcode: string): Promise<LookupState> {
    this.cancelLookup();
    const operationId = newOperationId('lookup');
    const controller = new AbortController();
    this.controller = controller;
    this.set({
      lookup: { status: 'pending', operationId, barcode, stage: 'lookup' },
    });

    let outcome: LookupOutcome;
    try {
      outcome = await this.catalogue.lookupBarcode(barcode, {
        signal: controller.signal,
      });
    } catch {
      outcome = { state: 'upstream_unavailable', issues: [] };
    }
    if (!this.isCurrent(operationId)) {
      return this.state.lookup;
    }
    if (outcome.state !== 'found') {
      if (outcome.state === 'cancelled') {
        this.set({ lookup: { status: 'idle' } });
        return this.state.lookup;
      }
      this.set({
        lookup: {
          status: 'failed',
          operationId,
          barcode,
          failure: toLookupFailure(outcome),
        },
      });
      return this.state.lookup;
    }

    this.set({
      lookup: { status: 'pending', operationId, barcode, stage: 'analysis' },
    });
    const analysed = await this.runAnalysis(
      outcome.snapshot,
      controller.signal,
    );
    if (!this.isCurrent(operationId)) {
      return this.state.lookup;
    }
    if (analysed === null) {
      this.set({
        lookup: {
          status: 'failed',
          operationId,
          barcode,
          failure: { status: 'upstream_unavailable' },
        },
      });
      return this.state.lookup;
    }
    const science = toScientificView(analysed.assessment.scientific);
    // Ingredients first (D131): an ingredient list is a result on its own;
    // only a record with neither panel stays on lookup for a photo.
    const hasIngredients = outcome.snapshot.panels.some(
      (panel) =>
        panel.panel === 'ingredients' &&
        (panel.state === 'read' || panel.state === 'uncertain'),
    );
    if (!opensResultAutomatically(science) && !hasIngredients) {
      this.set({
        lookup: {
          status: 'incomplete',
          operationId,
          barcode,
          base: outcome.snapshot,
          gaps: issueGaps(analysed.assessment.scientific.issues),
        },
      });
      return this.state.lookup;
    }
    const resultKey = this.addResult(
      outcome.snapshot,
      analysed.assessment,
      analysed.executor,
    );
    this.noteFallback(resultKey, analysed.fallbackIssue);
    this.watchUpdate(resultKey, analysed.lateUpdate, controller.signal);
    this.set({ lookup: { status: 'opened', operationId, barcode, resultKey } });
    return this.state.lookup;
  }

  /** Cancels the running lookup; its late completion is ignored. */
  cancelLookup(): void {
    this.controller?.abort();
    this.controller = null;
    if (this.state.lookup.status !== 'idle') {
      this.set({ lookup: { status: 'idle' } });
    }
  }

  /** Clears a finished lookup once its screen has handled it. */
  acknowledgeLookup(operationId: string): void {
    if (this.isCurrent(operationId) && this.state.lookup.status !== 'pending') {
      this.set({ lookup: { status: 'idle' } });
    }
  }

  private async runAnalysis(snapshot: ProductSnapshot, signal: AbortSignal) {
    try {
      return await this.analyser.analyse(snapshot, signal);
    } catch {
      return null;
    }
  }

  /**
   * Analyses a label-built snapshot. Returns the result key, or null when
   * the analysis failed or `isCurrent()` turned false (cancelled).
   */
  async analyseSnapshot(
    snapshot: ProductSnapshot,
    signal: AbortSignal,
  ): Promise<string | null> {
    const analysed = await this.runAnalysis(snapshot, signal);
    if (analysed === null || signal.aborted) {
      return null;
    }
    const resultKey = this.addResult(
      snapshot,
      analysed.assessment,
      analysed.executor,
    );
    this.noteFallback(resultKey, analysed.fallbackIssue);
    this.watchUpdate(resultKey, analysed.lateUpdate, signal);
    return resultKey;
  }

  private noteFallback(resultKey: string, issue: Issue | undefined): void {
    const result = this.state.results[resultKey];
    if (issue && result) {
      this.setResult({ ...result, fallbackIssue: issue });
    }
  }

  /**
   * Stores a late backend result as an offer on the displayed result (D70).
   * It is dropped when the scan was cancelled or superseded (the signal is
   * aborted), when the result is gone, or when it came from History.
   */
  private watchUpdate(
    resultKey: string,
    lateUpdate: Promise<AnalysisUpdate | null> | undefined,
    signal: AbortSignal,
  ): void {
    if (!lateUpdate) {
      return;
    }
    const epoch = this.updateEpoch;
    lateUpdate.then(
      (update) => {
        const result = this.state.results[resultKey];
        if (
          update === null ||
          signal.aborted ||
          epoch !== this.updateEpoch ||
          !result ||
          result.origin !== 'new'
        ) {
          return;
        }
        this.setResult({
          ...result,
          pendingUpdate: {
            assessment: update.assessment,
            executor: update.executor,
            introducesHardFinding: update.introducesHardFinding,
            differsFromDisplayed: !sameHeadline(
              result.assessment,
              update.assessment,
            ),
          },
        });
      },
      () => undefined,
    );
  }

  /**
   * The user opened the offered update. It becomes a new result, so the
   * phone result stays exactly as it was and Back returns to it. Returns the
   * new result key, or null when there is no offer.
   */
  openUpdate(resultKey: string): string | null {
    const result = this.state.results[resultKey];
    const update = result?.pendingUpdate;
    if (!result || !update) {
      return null;
    }
    this.setResult({ ...result, pendingUpdate: null });
    const updatedKey = this.addResult(
      result.snapshot,
      update.assessment,
      update.executor,
    );
    const updated = this.state.results[updatedKey];
    if (updated) {
      this.setResult({ ...updated, updateOf: resultKey });
    }
    return updatedKey;
  }

  /**
   * Leaving the foreground (HYB-01 case 5): clear offers not yet opened and
   * ignore late updates still on their way. The hybrid client cancels its
   * own request; the displayed results are untouched.
   */
  dropPendingUpdates(): void {
    this.updateEpoch += 1;
    const results: Record<string, StoredResult> = {};
    let changed = false;
    for (const [key, result] of Object.entries(this.state.results)) {
      if (result.pendingUpdate) {
        changed = true;
        results[key] = { ...result, pendingUpdate: null };
      } else {
        results[key] = result;
      }
    }
    if (changed) {
      this.set({ results });
    }
  }

  private setResult(result: StoredResult): void {
    this.set({
      results: { ...this.state.results, [result.resultKey]: result },
    });
  }

  addResult(
    snapshot: ProductSnapshot,
    assessment: LocalAssessment,
    executor: StoredResult['executor'],
    origin: StoredResult['origin'] = 'new',
    savedId: string | null = null,
    analysedAt: string = this.now().toISOString(),
  ): string {
    const resultKey = newOperationId('result');
    this.set({
      results: {
        ...this.state.results,
        [resultKey]: {
          resultKey,
          snapshot,
          assessment,
          executor,
          analysedAt,
          origin,
          savedId,
          pendingUpdate: null,
          updateOf: null,
          fallbackIssue: null,
        },
      },
    });
    return resultKey;
  }

  markSaved(resultKey: string, savedId: string): void {
    const result = this.state.results[resultKey];
    if (!result) {
      return;
    }
    this.setResult({ ...result, savedId });
  }

  /** Drops the saved link after the saved copy is deleted. */
  forgetSaved(savedId: string): void {
    const results: Record<string, StoredResult> = {};
    for (const [key, result] of Object.entries(this.state.results)) {
      results[key] =
        result.savedId === savedId ? { ...result, savedId: null } : result;
    }
    this.set({ results });
  }

  getResult(resultKey: string): StoredResult | undefined {
    return this.state.results[resultKey];
  }
}
