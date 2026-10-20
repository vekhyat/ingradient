import { describe, expect, it } from '@jest/globals';
import manifestJson from '../../../resources/manifest.json';
import vectorsJson from '../../../resources/vectors/nutriscore-vectors.json';
import { localValidators } from '../contracts';
import type {
  ProductSnapshot,
  ScientificAssessment,
} from '../contracts/generated/local';
import { EVIDENCE_VERSION } from '../evidence';
import { renderReplayedBackendReasons } from './backend-replay-renderer';
import { replayScientificSnapshot } from './replay-scientific-snapshot';

type Graded = Extract<ScientificAssessment, { state: 'graded' }>;

function snapshotFor(
  vector: (typeof vectorsJson.vectors)[number],
): ProductSnapshot {
  const presence = (flag: boolean | string) =>
    flag === true || flag === 'present'
      ? { state: 'present', sourceIds: ['source'] }
      : flag === false || flag === 'absent'
        ? { state: 'absent', sourceIds: ['source'] }
        : { state: 'unknown' };
  const candidate: unknown = {
    id: `backend-replay-${vector.id}`,
    barcode: null,
    name: 'Synthetic backend replay',
    market: 'EU',
    capturedAt: '2026-10-18T12:00:00Z',
    sourceRefs: [{ id: 'source', kind: 'label', title: 'Synthetic label' }],
    observations: vector.inputs.observations.map((observation) => ({
      ...observation,
      kind: 'read',
      sourceIds: ['source'],
      issues: [],
    })),
    ingredients: [],
    panels: [],
    category: vector.inputs.category,
    scoringFacts: {
      categorySourceIds: vector.inputs.category === 'unknown' ? [] : ['source'],
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
  if (!localValidators.ProductSnapshot(candidate)) {
    throw new Error('Invalid synthetic snapshot');
  }
  return candidate as ProductSnapshot;
}

function gradedFixture(): { snapshot: ProductSnapshot; server: Graded } {
  const vector = vectorsJson.vectors[0];
  if (!vector) throw new Error('Missing canonical vector');
  const snapshot = snapshotFor(vector);
  const server = replayScientificSnapshot(snapshot).scientific;
  if (server.state !== 'graded') throw new Error('Expected graded fixture');
  return { snapshot, server };
}

/** Rebuild object properties in reverse insertion order without changing values. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)]),
    );
  }
  return value;
}

describe('renderReplayedBackendReasons', () => {
  it.each([
    ['zero protein', 0, 0.8],
    ['protein at the cap', 6, 0.8],
    ['protein not counted', 20, 3],
  ])(
    'accepts unchanged backend protein evidence for red meat with %s',
    (_name, protein, salt) => {
      const vector = vectorsJson.vectors[0];
      if (!vector) throw new Error('Missing canonical fixture');
      const snapshot = snapshotFor(vector);
      snapshot.observations = snapshot.observations.map((obs) =>
        obs.kind === 'read' && (obs.field === 'protein' || obs.field === 'salt')
          ? { ...obs, value: obs.field === 'protein' ? protein : salt }
          : obs,
      );
      // The backend keeps ordinary/uncounted protein evidence when the cap has
      // no effect. Derive that evidence independently with red meat absent.
      const server = replayScientificSnapshot(snapshot).scientific;
      if (!snapshot.scoringFacts) throw new Error('Missing facts');
      snapshot.scoringFacts.redMeat = {
        state: 'present',
        sourceIds: ['source'],
      };
      const reviewed = renderReplayedBackendReasons(snapshot, server);
      if (!reviewed) throw new Error('Expected accepted replay');
      expect(reviewed.issues).toEqual([]);
      expect(reviewed.reasons).toEqual(server.reasons);
      expect(
        server.reasons.some(
          (reason) => reason.templateId === 'nutriscore.protein_red_meat',
        ),
      ).toBe(false);
    },
  );

  it.each(vectorsJson.vectors)(
    'accepts matching actual replay for $id',
    (vector) => {
      const snapshot = snapshotFor(vector);
      const replay = replayScientificSnapshot(snapshot);
      const server = {
        ...replay.scientific,
        reasons: replay.scientific.reasons.map((reason) => ({
          ...reason,
          id: `server-${reason.id}`,
          text: 'UNTRUSTED SERVER SENTENCE',
        })),
      } as ScientificAssessment;
      expect(renderReplayedBackendReasons(snapshot, server)).toEqual({
        reasons: replay.scientific.reasons,
        citations: replay.citations,
        issues: replay.issues,
      });
    },
  );

  const mutations: [string, (server: Graded) => void][] = [
    [
      'grade',
      (server) => {
        server.grade = 'E';
      },
    ],
    [
      'score',
      (server) => {
        server.score += 1;
      },
    ],
    [
      'route',
      (server) => {
        server.route = 'beverage';
      },
    ],
    [
      'method id',
      (server) => {
        server.method.id = 'unknown-method';
      },
    ],
    [
      'method edition',
      (server) => {
        server.method.edition = 'unknown-edition';
      },
    ],
    [
      'method bundle id',
      (server) => {
        server.method.bundleId = 'unknown-bundle';
      },
    ],
    [
      'method hash',
      (server) => {
        server.method.bundleSha256 = '0'.repeat(64);
      },
    ],
    [
      'trace points',
      (server) => {
        server.trace[0].points += 1;
      },
    ],
    [
      'trace component',
      (server) => {
        server.trace[0].component = 'invented';
      },
    ],
    [
      'trace locator',
      (server) => {
        server.trace[0].ruleLocator = 'invented';
      },
    ],
    [
      'trace inputs',
      (server) => {
        server.trace[0].inputFields = ['protein'];
      },
    ],
    [
      'trace citations',
      (server) => {
        server.trace[0].citationIds = ['unknown'];
      },
    ],
    [
      'trace repeated citations',
      (server) => {
        server.trace[0].citationIds.push(server.trace[0].citationIds[0]);
      },
    ],
    [
      'trace omission',
      (server) => {
        server.trace.splice(1, 1);
      },
    ],
    [
      'reason template',
      (server) => {
        server.reasons[0].templateId = 'unknown';
      },
    ],
    [
      'reason step',
      (server) => {
        server.reasons[0].step = 'unknown';
      },
    ],
    [
      'reason inputs',
      (server) => {
        server.reasons[0].inputFields = ['protein'];
      },
    ],
    [
      'reason citations',
      (server) => {
        server.reasons[0].citationIds = ['unknown'];
      },
    ],
    [
      'reason repeated inputs',
      (server) => {
        server.reasons[0].inputFields.push(...server.reasons[0].inputFields);
      },
    ],
    [
      'reason omission',
      (server) => {
        server.reasons.splice(1, 1);
      },
    ],
    [
      'reason duplication',
      (server) => {
        server.reasons.push(server.reasons[0]);
      },
    ],
    [
      'snapshot identity',
      (server) => {
        server.inputSnapshotId = 'other-snapshot';
      },
    ],
  ];

  it.each(mutations)('rejects changed %s', (_name, mutate) => {
    const { snapshot, server } = gradedFixture();
    mutate(server);
    expect(renderReplayedBackendReasons(snapshot, server)).toBeNull();
  });

  it('rejects a refusal on a snapshot the phone can grade', () => {
    const { snapshot } = gradedFixture();
    expect(
      renderReplayedBackendReasons(snapshot, {
        state: 'insufficient_data',
        inputSnapshotId: snapshot.id,
        reasons: [],
        issues: [
          {
            code: 'missing',
            stage: 'completeness',
            message: 'Server copy',
            action: 'retake',
          },
        ],
      }),
    ).toBeNull();
  });

  it('rejects a grade when local resources cannot replay it', () => {
    const { snapshot, server } = gradedFixture();
    snapshot.evidenceVersion = 'incompatible';
    expect(renderReplayedBackendReasons(snapshot, server)).toBeNull();
  });

  it('accepts equal structures with different object key and reference order', () => {
    const { snapshot, server } = gradedFixture();
    for (const step of server.trace) {
      step.inputFields.reverse();
      step.citationIds.reverse();
    }
    for (const reason of server.reasons) {
      reason.inputFields.reverse();
      reason.citationIds.reverse();
    }
    const reordered = reverseKeys(server);
    if (!localValidators.ScientificAssessment(reordered)) {
      throw new Error('Invalid reordered assessment');
    }
    expect(
      renderReplayedBackendReasons(snapshot, reordered as ScientificAssessment),
    ).not.toBeNull();
  });

  it('keeps local mapping diagnostics for a supported answer', () => {
    const { snapshot } = gradedFixture();
    snapshot.observations.push({
      field: 'fat',
      kind: 'missing',
      reason: 'unreadable',
      issues: [],
    });
    const replay = replayScientificSnapshot(snapshot);
    expect(
      renderReplayedBackendReasons(snapshot, replay.scientific)?.issues,
    ).toContainEqual(
      expect.objectContaining({ code: 'unusable_observation', field: 'fat' }),
    );
  });

  it('does not mutate the snapshot or server answer', () => {
    const { snapshot, server } = gradedFixture();
    const before = JSON.stringify({ snapshot, server });
    renderReplayedBackendReasons(snapshot, server);
    expect(JSON.stringify({ snapshot, server })).toBe(before);
  });
});
