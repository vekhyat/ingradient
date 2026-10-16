import { useMemo } from 'react';

import { toResultView } from '../../view-models/map-result';
import type { ResultView } from '../../view-models/types';
import { useScanState } from '../app/services';
import type { StoredResult } from '../scan/scan-session';

/** The stored result for a route key, and its view model. */
export function useResult(
  key: string | undefined,
): { stored: StoredResult; view: ResultView } | null {
  const { results } = useScanState();
  const stored = key ? results[key] : undefined;
  return useMemo(() => {
    if (!stored) {
      return null;
    }
    const view = toResultView({
      snapshot: stored.snapshot,
      assessment: stored.assessment,
      executor: stored.executor,
      analysedAt: stored.analysedAt,
    });
    return { stored, view: { ...view, resultKey: stored.resultKey } };
  }, [stored]);
}
