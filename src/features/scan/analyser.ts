import type {
  Issue,
  LocalAssessment,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';

/**
 * The one analysis interface screens depend on. A backend call (HYB-01) and
 * the phone's own engine (SCI-01) will both implement it and return the same
 * shape (00-local-views, "Hybrid analysis boundary").
 */
export interface AnalysisResult {
  assessment: LocalAssessment;
  executor: 'phone' | 'backend';
  /**
   * D70: a backend result that arrived after the phone result was shown.
   * The client (HYB-01) decides eligibility (digest, editions, method
   * bundle, active scan revision) and resolves null when there is none or
   * the request was cancelled. The screen only offers it; it never applies
   * it by itself.
   */
  lateUpdate?: Promise<AnalysisUpdate | null>;
  /** Why the phone answered instead of the backend, when it was not timing. */
  fallbackIssue?: Issue;
}

export interface AnalysisUpdate {
  assessment: LocalAssessment;
  executor: 'backend';
  /** True when the update adds a hard finding the displayed result lacks. */
  introducesHardFinding: boolean;
}

export interface ProductAnalyser {
  analyse(
    snapshot: ProductSnapshot,
    signal: AbortSignal,
  ): Promise<AnalysisResult>;
}

/** What an analyser may know about the app, read at call time. */
export interface AnalyserContext {
  /**
   * ONB-01: the onboarding notice version the user accepted, or null. A
   * backend analyser must refuse to submit while this is null (HYB-01 case 6).
   */
  acceptedNoticeVersion(): string | null;
}

function hasNutritionValues(snapshot: ProductSnapshot): boolean {
  return snapshot.observations.some(
    (observation) => observation.kind !== 'missing',
  );
}

/**
 * Stand-in until SCI-01 (phone grading) and HYB-01 (backend client) exist.
 *
 * It never invents a letter. A record with no nutrition values is reported
 * as insufficient data, so the user is offered a label photo; anything else
 * is reported as "method unavailable", which the result screen explains.
 */
export const methodNotInstalledAnalyser: ProductAnalyser = {
  async analyse(snapshot, signal) {
    if (signal.aborted) {
      throw new DOMException('Analysis cancelled', 'AbortError');
    }
    const scientific: LocalAssessment['scientific'] = hasNutritionValues(
      snapshot,
    )
      ? {
          state: 'method_unavailable',
          inputSnapshotId: snapshot.id,
          reasons: [],
          issues: [
            {
              code: 'method_not_installed',
              stage: 'method',
              message:
                'The grading method is not installed in this build yet, so no letter is shown.',
              action: 'none',
            },
          ],
        }
      : {
          state: 'insufficient_data',
          inputSnapshotId: snapshot.id,
          reasons: [],
          issues: [
            {
              code: 'nutrition_missing',
              stage: 'completeness',
              field: 'nutrition',
              message: 'There is no nutrition table on this record.',
              action: 'retake',
            },
          ],
        };
    return {
      executor: 'phone',
      assessment: {
        snapshotId: snapshot.id,
        scientific,
        personal: { state: 'not_in_slice', issues: [] },
        citations: [],
      },
    };
  },
};
