import {
  createHybridAnalyser,
  type HybridAnalyser,
  type HybridClock,
} from '../../adapters/backend/hybrid-analyser';
import { installedResources } from '../../domain/hybrid/resources';
import { renderReplayedBackendReasons } from '../../domain/pipeline/backend-replay-renderer';
import { phoneAnalyser } from '../../domain/pipeline/phone-analyser';
import type { AnalyserContext, ProductAnalyser } from '../scan/analyser';

interface AnalysisOptions {
  baseUrl: string;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  clock?: HybridClock;
}

/** App composition: real phone replay, with an explicitly configured backend. */
export function createAnalysis(
  context: AnalyserContext,
  options: AnalysisOptions,
): { analyser: ProductAnalyser; hybrid: HybridAnalyser | null } {
  if (options.baseUrl.length === 0) {
    return { analyser: phoneAnalyser, hybrid: null };
  }
  const hybrid = createHybridAnalyser({
    baseUrl: options.baseUrl,
    fetch: options.fetch,
    local: phoneAnalyser,
    context,
    resources: installedResources(),
    renderReasons: renderReplayedBackendReasons,
    ...(options.clock ? { clock: options.clock } : {}),
  });
  return { analyser: hybrid, hybrid };
}
