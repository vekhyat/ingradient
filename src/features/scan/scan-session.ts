import type {
  LocalAssessment,
  LookupOutcome,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';
import {
  opensResultAutomatically,
  toLookupFailure,
  toScientificView,
} from '../../view-models/map-result';
import type { LookupFailure } from '../../view-models/types';
import type { ProductAnalyser } from './analyser';

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
    if (!opensResultAutomatically(science)) {
      this.set({
        lookup: {
          status: 'incomplete',
          operationId,
          barcode,
          base: outcome.snapshot,
          gaps: analysed.assessment.scientific.issues.map(
            (issue) => issue.message,
          ),
        },
      });
      return this.state.lookup;
    }
    const resultKey = this.addResult(
      outcome.snapshot,
      analysed.assessment,
      analysed.executor,
    );
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
    return this.addResult(snapshot, analysed.assessment, analysed.executor);
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
    this.set({
      results: { ...this.state.results, [resultKey]: { ...result, savedId } },
    });
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
