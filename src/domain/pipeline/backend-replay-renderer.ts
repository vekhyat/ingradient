import type { ReasonRenderer } from '../../adapters/backend/hybrid-analyser';
import type { ScientificReason, TraceStep } from '../contracts/generated/local';
import { renderBackendReasons } from '../evidence';
import { replayScientificSnapshot } from './replay-scientific-snapshot';

/** Reference order carries no meaning; duplicate references are never valid. */
function sameReferences(
  expected: readonly string[],
  actual: readonly string[],
) {
  const references = new Set(actual);
  return (
    new Set(expected).size === expected.length &&
    references.size === actual.length &&
    expected.length === actual.length &&
    expected.every((reference) => references.has(reference))
  );
}

function sameReason(expected: ScientificReason, actual: ScientificReason) {
  return (
    expected.templateId === actual.templateId &&
    expected.step === actual.step &&
    sameReferences(expected.inputFields, actual.inputFields) &&
    sameReferences(expected.citationIds, actual.citationIds)
  );
}

function sameTrace(expected: TraceStep, actual: TraceStep) {
  return (
    expected.component === actual.component &&
    expected.points === actual.points &&
    expected.ruleLocator === actual.ruleLocator &&
    sameReferences(expected.inputFields, actual.inputFields) &&
    sameReferences(expected.citationIds, actual.citationIds)
  );
}

/** Accepts backend evidence only when the installed method reproduces it. */
export const renderReplayedBackendReasons: ReasonRenderer = (
  snapshot,
  server,
) => {
  const replay = replayScientificSnapshot(snapshot);
  const local = replay.scientific;
  if (
    server.inputSnapshotId !== snapshot.id ||
    server.state !== local.state ||
    server.reasons.length !== local.reasons.length ||
    !local.reasons.every((reason, index) => {
      const actual = server.reasons[index];
      return actual !== undefined && sameReason(reason, actual);
    })
  ) {
    return null;
  }
  if (server.state === 'graded') {
    if (
      local.state !== 'graded' ||
      server.grade !== local.grade ||
      server.score !== local.score ||
      server.route !== local.route ||
      server.method.id !== local.method.id ||
      server.method.edition !== local.method.edition ||
      server.method.bundleId !== local.method.bundleId ||
      server.method.bundleSha256 !== local.method.bundleSha256 ||
      server.method.label !== local.method.label ||
      server.trace.length !== local.trace.length ||
      !local.trace.every((step, index) => {
        const actual = server.trace[index];
        return actual !== undefined && sameTrace(step, actual);
      })
    ) {
      return null;
    }
  }
  const rendered = renderBackendReasons(server.reasons, replay);
  if (rendered.issues.length > 0) return null;
  return {
    reasons: rendered.reasons,
    citations: [...replay.citations],
    issues: [...replay.issues],
  };
};
