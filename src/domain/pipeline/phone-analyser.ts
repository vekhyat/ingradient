import type { ProductAnalyser } from '../../features/scan/analyser';
import type { ScientificAssessment } from '../contracts/generated/local';
import { replayScientificSnapshot } from './replay-scientific-snapshot';

/** Runs the installed scientific method without adding personal assessment. */
export const phoneAnalyser: ProductAnalyser = {
  async analyse(snapshot, signal) {
    if (signal.aborted) {
      throw new DOMException('Analysis cancelled', 'AbortError');
    }
    const replay = replayScientificSnapshot(snapshot);
    // Mapping diagnostics have no separate slot in LocalAssessment. Keep them
    // with the scientific outcome, without repeating a blocking replay issue.
    const issues = [...replay.scientific.issues];
    for (const issue of replay.issues) {
      if (
        !issues.some(
          (existing) =>
            existing.code === issue.code &&
            existing.stage === issue.stage &&
            existing.field === issue.field &&
            existing.action === issue.action &&
            existing.message === issue.message,
        )
      ) {
        issues.push(issue);
      }
    }
    // Let cancellation in the caller's current turn win before publication.
    await Promise.resolve();
    if (signal.aborted) {
      throw new DOMException('Analysis cancelled', 'AbortError');
    }
    const scientific: ScientificAssessment =
      replay.scientific.state === 'graded'
        ? { ...replay.scientific, issues }
        : {
            ...replay.scientific,
            issues: [replay.scientific.issues[0], ...issues.slice(1)],
          };
    return {
      executor: 'phone',
      assessment: {
        snapshotId: snapshot.id,
        scientific,
        personal: { state: 'not_in_slice', issues: [] },
        citations: [...replay.citations],
      },
    };
  },
};
