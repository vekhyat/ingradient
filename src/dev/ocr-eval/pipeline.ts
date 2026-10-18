import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import {
  splitLabelPanels,
  type LabelPanels,
} from '../../features/capture/label-panels';
import {
  applyPhoto,
  createLabelSession,
} from '../../features/capture/label-session';
import {
  buildLabelSnapshot,
  NO_CORRECTIONS,
} from '../../features/capture/label-snapshot';
import type { OcrOutcome } from '../../features/capture/ocr-page';
import type { RunConfig } from './dataset';

export interface EvalResult {
  schemaVersion: 1;
  id: string;
  imageSha256: string;
  run: RunConfig;
  capturedAt: string;
  elapsedMs: number;
  outcome: OcrOutcome;
  panels: LabelPanels;
  snapshot: ProductSnapshot;
}

/** Same uncorrected single-photo pipeline as capture; no matcher, repair or upload. */
export function buildEvalResult(input: {
  id: string;
  imageSha256: string;
  run: RunConfig;
  capturedAt: string;
  elapsedMs: number;
  outcome: OcrOutcome;
}): EvalResult {
  const panels =
    input.outcome.status === 'read'
      ? splitLabelPanels(input.outcome.page)
      : { ingredientsText: null, nutritionFragments: [] };
  const applied = applyPhoto(
    createLabelSession(input.id, null),
    {
      imageId: input.id,
      uri: `private-evaluation://${input.id}`,
    },
    panels,
    null,
  );
  return {
    schemaVersion: 1,
    ...input,
    panels,
    snapshot: buildLabelSnapshot({
      session: applied.session,
      corrections: NO_CORRECTIONS,
      capturedAt: input.capturedAt,
      base: null,
    }),
  };
}
