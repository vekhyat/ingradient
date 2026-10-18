import { describe, expect, it } from '@jest/globals';
import manifestJson from '../../../resources/manifest.json';
import vectorsJson from '../../../resources/vectors/nutriscore-vectors.json';
import { localValidators } from '../contracts';
import type { ProductSnapshot } from '../contracts/generated/local';
import { EVIDENCE_VERSION } from '../evidence';
import { phoneAnalyser } from './phone-analyser';
import { replayScientificSnapshot } from './replay-scientific-snapshot';

function snapshotFor(
  vector: (typeof vectorsJson.vectors)[number],
): ProductSnapshot {
  const sourceId = 'label-source';
  const presence = (flag: boolean | string) =>
    flag === true || flag === 'present'
      ? { state: 'present', sourceIds: [sourceId] }
      : flag === false || flag === 'absent'
        ? { state: 'absent', sourceIds: [sourceId] }
        : { state: 'unknown' };
  const snapshot: unknown = {
    id: `phone-${vector.id}`,
    barcode: null,
    name: 'Synthetic method fixture',
    market: 'EU',
    capturedAt: '2026-10-18T12:00:00Z',
    sourceRefs: [{ id: sourceId, kind: 'label', title: 'Synthetic label' }],
    observations: vector.inputs.observations.map((observation) => ({
      ...observation,
      kind: 'read',
      sourceIds: [sourceId],
      issues: [],
    })),
    ingredients: [],
    panels: [],
    category: vector.inputs.category,
    scoringFacts: {
      categorySourceIds: vector.inputs.category === 'unknown' ? [] : [sourceId],
      cheese: presence(vector.inputs.flags.cheese),
      redMeat: presence(vector.inputs.flags.redMeat),
      plainWater: presence(vector.inputs.flags.plainWater),
      nonNutritiveSweetener: presence(
        vector.inputs.flags.nonNutritiveSweetener,
      ),
    },
    taxonomyVersion: `off-taxonomy-ingredients@${manifestJson.revision}`,
    evidenceVersion: EVIDENCE_VERSION,
  };
  if (!localValidators.ProductSnapshot(snapshot)) {
    throw new Error('Invalid synthetic snapshot');
  }
  return snapshot as ProductSnapshot;
}

function firstSnapshot(): ProductSnapshot {
  const vector = vectorsJson.vectors[0];
  if (!vector) throw new Error('Missing canonical vector');
  return snapshotFor(vector);
}

describe('phoneAnalyser', () => {
  it.each(vectorsJson.vectors)(
    'runs the installed method for $id',
    async (vector) => {
      const snapshot = snapshotFor(vector);
      const before = JSON.stringify(snapshot);
      const result = await phoneAnalyser.analyse(
        snapshot,
        new AbortController().signal,
      );
      expect(result.executor).toBe('phone');
      expect(result.assessment.snapshotId).toBe(snapshot.id);
      expect(result.assessment.scientific.inputSnapshotId).toBe(snapshot.id);
      expect(result.assessment.scientific.state).toBe(
        vector.expectedAssessment.state,
      );
      if (result.assessment.scientific.state === 'graded') {
        expect(vector.expectedAssessment).toMatchObject({
          grade: result.assessment.scientific.grade,
          score: result.assessment.scientific.score,
          route: result.assessment.scientific.route,
        });
      }
      expect(result.assessment.personal).toEqual({
        state: 'not_in_slice',
        issues: [],
      });
      expect(localValidators.LocalAssessment(result.assessment)).toBe(true);
      expect(JSON.stringify(snapshot)).toBe(before);
      for (const reason of result.assessment.scientific.reasons) {
        for (const id of reason.citationIds) {
          expect(result.assessment.citations.some((c) => c.id === id)).toBe(
            true,
          );
        }
      }
    },
  );

  it('keeps optional mapping diagnostics without losing the supported grade', async () => {
    const snapshot = firstSnapshot();
    snapshot.observations.push({
      field: 'fat',
      kind: 'missing',
      reason: 'unreadable',
      issues: [],
    });
    const result = await phoneAnalyser.analyse(
      snapshot,
      new AbortController().signal,
    );
    expect(result.assessment.scientific.state).toBe('graded');
    expect(result.assessment.scientific.issues).toContainEqual(
      expect.objectContaining({ code: 'unusable_observation', field: 'fat' }),
    );
    expect(result.assessment.citations).toEqual(
      replayScientificSnapshot(snapshot).citations,
    );
  });

  it('keeps a provenance refusal and its diagnostics exactly once', async () => {
    const snapshot = firstSnapshot();
    delete snapshot.scoringFacts;
    const result = await phoneAnalyser.analyse(
      snapshot,
      new AbortController().signal,
    );
    expect(result.assessment.scientific.state).toBe('insufficient_data');
    expect(
      result.assessment.scientific.issues.filter(
        (issue) => issue.code === 'missing_category_provenance',
      ),
    ).toHaveLength(1);
    expect(result.assessment.scientific).not.toHaveProperty('grade');
  });

  it('returns method unavailable for incompatible resources', async () => {
    const snapshot = firstSnapshot();
    snapshot.evidenceVersion = 'unavailable-edition';
    const result = await phoneAnalyser.analyse(
      snapshot,
      new AbortController().signal,
    );
    expect(result.assessment.scientific.state).toBe('method_unavailable');
    expect(result.assessment.scientific).not.toHaveProperty('grade');
  });

  it('rejects an already cancelled operation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      phoneAnalyser.analyse(firstSnapshot(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects cancellation before the replay is published', async () => {
    const controller = new AbortController();
    const pending = phoneAnalyser.analyse(firstSnapshot(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
