import { describe, expect, it } from '@jest/globals';
import vectorsJson from '../../../resources/vectors/nutriscore-vectors.json';
import manifestJson from '../../../resources/manifest.json';
import { localValidators } from '../contracts';
import type {
  NutrientObservation,
  PresenceFact,
  ProductSnapshot,
  ScoringFacts,
} from '../contracts/generated/local';
import { EVIDENCE_VERSION } from '../evidence';
import type { FactState } from '../scientific';
import { replayScientificSnapshot } from './replay-scientific-snapshot';

type Vector = (typeof vectorsJson.vectors)[number];
const vectors = vectorsJson.vectors;

function isProductSnapshot(value: unknown): value is ProductSnapshot {
  return localValidators.ProductSnapshot(value);
}

function requireFacts(snapshot: ProductSnapshot): ScoringFacts {
  if (!snapshot.scoringFacts) throw new Error('Expected fixture scoring facts');
  return snapshot.scoringFacts;
}

function deepFreeze(value: unknown): void {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
}

function getVector(indexOrId: number | string): Vector {
  const v =
    typeof indexOrId === 'number'
      ? vectors[indexOrId]
      : vectors.find((item) => item.id === indexOrId);
  if (!v) {
    throw new Error(`Vector not found: ${indexOrId}`);
  }
  return v;
}

function toState(flag: unknown): FactState {
  if (flag === true || flag === 'present') return 'present';
  if (flag === false || flag === 'absent') return 'absent';
  return 'unknown';
}

function toPresenceFact(flag: unknown, sourceId: string): PresenceFact {
  const state = toState(flag);
  if (state === 'unknown') {
    return { state: 'unknown' };
  }
  return { state, sourceIds: [sourceId] };
}

function buildSyntheticSnapshot(vector: Vector): ProductSnapshot {
  const sourceId = 'src-1';
  const candidate: unknown = {
    id: `snapshot-${vector.id}`,
    barcode: null,
    name: `Synthetic product ${vector.id}`,
    market: 'EU',
    capturedAt: '2026-10-18T12:00:00Z',
    sourceRefs: [
      {
        id: sourceId,
        kind: 'label',
        title: 'Nutritional Declaration Panel',
        locator: 'panel-1',
      },
    ],
    category: vector.inputs.category,
    scoringFacts: {
      categorySourceIds: vector.inputs.category === 'unknown' ? [] : [sourceId],
      cheese: toPresenceFact(vector.inputs.flags.cheese, sourceId),
      redMeat: toPresenceFact(vector.inputs.flags.redMeat, sourceId),
      plainWater: toPresenceFact(vector.inputs.flags.plainWater, sourceId),
      nonNutritiveSweetener: toPresenceFact(
        vector.inputs.flags.nonNutritiveSweetener,
        sourceId,
      ),
    },
    observations: vector.inputs.observations.map((obs) => ({
      field: obs.field,
      value: obs.value,
      unit: obs.unit,
      basis: obs.basis,
      kind: 'read',
      sourceIds: [sourceId],
      issues: [],
    })),
    ingredients: [],
    panels: [
      {
        panel: 'ingredients',
        state: 'read',
        imageId: 'mock-image',
        regionId: 'ingredients',
        issues: [],
      },
      {
        panel: 'nutrition',
        state: 'read',
        imageId: 'mock-image',
        regionId: 'nutrition',
        issues: [],
      },
    ],
    taxonomyVersion: `off-taxonomy-ingredients@${manifestJson.revision}`,
    evidenceVersion: EVIDENCE_VERSION,
  };
  if (!isProductSnapshot(candidate))
    throw new Error(`Invalid snapshot fixture ${vector.id}`);
  return candidate;
}

describe('replayScientificSnapshot', () => {
  it.each([
    'vector-general-mid',
    'vector-fats-olive-oil',
    'vector-beverage-sweetener',
  ])(
    'uses the required per-100 column when other bases are present: %s',
    (id) => {
      const snapshot = buildSyntheticSnapshot(getVector(id));
      const baseline = replayScientificSnapshot(snapshot).scientific;
      const extra = snapshot.observations.flatMap<NutrientObservation>((obs) =>
        obs.kind === 'read'
          ? [
              { ...obs, basis: 'per_serving', value: 99 },
              {
                ...obs,
                basis: obs.basis === 'per_100_g' ? 'per_100_ml' : 'per_100_g',
                value: 99,
              },
            ]
          : [],
      );
      // Unusable extra columns must not hide a usable scoring column either.
      snapshot.observations = [...extra, ...snapshot.observations];
      expect(replayScientificSnapshot(snapshot).scientific).toEqual(baseline);
      snapshot.observations[0] = {
        ...extra[0],
        kind: 'uncertain',
      } as NutrientObservation;
      expect(replayScientificSnapshot(snapshot).scientific).toEqual(baseline);
    },
  );

  it('still refuses conflicting required-basis observations beside a serving column', () => {
    const snapshot = buildSyntheticSnapshot(getVector(0));
    const obs = snapshot.observations[0];
    if (!obs || obs.kind !== 'read') throw new Error('Expected read fixture');
    snapshot.observations.push(
      { ...obs, value: 999 },
      { ...obs, basis: 'per_serving' },
    );
    const result = replayScientificSnapshot(snapshot).scientific;
    expect(result.state).toBe('insufficient_data');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'conflicting_energy' }),
    );
  });

  it('refuses an incompatible taxonomy edition', () => {
    const snapshot = buildSyntheticSnapshot(getVector(0));
    snapshot.taxonomyVersion = 'incompatible-taxonomy';
    expect(replayScientificSnapshot(snapshot).scientific.state).toBe(
      'method_unavailable',
    );
  });

  it('keeps an irrelevant unprovenanced fact unknown without blocking the grade', () => {
    const snapshot = buildSyntheticSnapshot(getVector(0));
    if (!snapshot.scoringFacts) throw new Error('Expected fixture facts');
    snapshot.scoringFacts.cheese = {
      state: 'absent',
      sourceIds: ['unresolvable-source'],
    };
    const result = replayScientificSnapshot(snapshot);
    expect(result.scientific.state).toBe('graded');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'unprovenanced_fact' }),
    );
  });

  it('preserves unusable optional-field diagnostics without blocking the grade', () => {
    const snapshot = buildSyntheticSnapshot(getVector(0));
    snapshot.observations.push({
      field: 'fat',
      kind: 'missing',
      reason: 'unreadable',
      issues: [],
    });
    const result = replayScientificSnapshot(snapshot);
    expect(result.scientific.state).toBe('graded');
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'unusable_observation', field: 'fat' }),
    );
  });

  describe('canonical Nutri-Score vectors replay', () => {
    it('covers all 15 canonical vectors as synthetic snapshots', () => {
      expect(vectors).toHaveLength(15);
    });

    it.each(vectors)('$id', (vector) => {
      const snapshot = buildSyntheticSnapshot(vector);
      const replay = replayScientificSnapshot(snapshot);

      expect(replay.scientific.inputSnapshotId).toBe(snapshot.id);
      expect(replay.scientific.state).toBe(vector.expectedAssessment.state);
      expect(localValidators.ScientificAssessment(replay.scientific)).toBe(
        true,
      );

      if (replay.scientific.state === 'graded') {
        expect(vector.expectedAssessment).toMatchObject({
          grade: replay.scientific.grade,
          score: replay.scientific.score,
          route: replay.scientific.route,
        });
        expect(replay.scientific.method?.id).toBe('nutriscore-updated-2023');
        expect(replay.scientific.reasons.length).toBeGreaterThan(0);
        expect(replay.scientific.trace?.length).toBeGreaterThan(0);
        expect(replay.citations.length).toBeGreaterThan(0);
        expect(replay.scientific.issues).toEqual([]);

        if (
          'trace' in vector.expectedAssessment &&
          vector.expectedAssessment.trace
        ) {
          const points = Object.fromEntries(
            (replay.scientific.trace ?? []).map((step) => [
              step.component,
              step.points,
            ]),
          );
          for (const step of vector.expectedAssessment.trace) {
            expect(points[step.component]).toBe(step.points);
          }
        }
      } else {
        expect(replay.scientific.reasons).toEqual([]);
        const actualIssueCodes = replay.scientific.issues.map((i) => i.code);
        for (const expectedIssue of vector.expectedAssessment.issues) {
          expect(actualIssueCodes).toContain(expectedIssue.code);
        }
      }
    });
  });

  describe('category provenance', () => {
    it('refuses with missing_category_provenance when categorySourceIds is empty', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        scoringFacts: {
          ...requireFacts(base),
          categorySourceIds: [],
        },
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'missing_category_provenance',
          field: 'scoringFacts.categorySourceIds',
        }),
      );
    });

    it('refuses with missing_category_provenance when categorySourceIds does not resolve', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        scoringFacts: {
          ...requireFacts(base),
          categorySourceIds: ['unresolvable-source-id'],
        },
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'missing_category_provenance',
          field: 'scoringFacts.categorySourceIds',
        }),
      );
    });

    it('refuses with missing_category_provenance when scoringFacts is absent for a known category', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const { scoringFacts: _, ...withoutScoringFacts } = base;

      const result = replayScientificSnapshot(withoutScoringFacts);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'missing_category_provenance',
        }),
      );
    });
  });

  describe('scoring facts provenance', () => {
    it('records unprovenanced_fact when a named fact has unresolvable sources', () => {
      const base = buildSyntheticSnapshot(getVector(4)); // cheese exception vector
      const snapshot: ProductSnapshot = {
        ...base,
        scoringFacts: {
          ...requireFacts(base),
          cheese: {
            state: 'present',
            sourceIds: ['unknown-source-id'],
          },
        },
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          code: 'unprovenanced_fact',
          field: 'scoringFacts.cheese',
        }),
      );
    });

    it('leaves schema-invalid empty source tuples at the contract boundary', () => {
      const base = buildSyntheticSnapshot(getVector(4));
      const snapshot: unknown = {
        ...base,
        scoringFacts: {
          ...requireFacts(base),
          cheese: {
            state: 'present',
            sourceIds: [],
          },
        },
      };

      expect(localValidators.ProductSnapshot(snapshot)).toBe(false);
    });
  });

  describe('nutrient observation usability and states', () => {
    it('accepts corrected observation with valid sources and no issues', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        sourceRefs: [
          ...base.sourceRefs,
          {
            id: 'correction-1',
            kind: 'user_correction',
            title: 'User correction',
          },
        ],
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'energy' && obs.kind === 'read'
            ? {
                ...obs,
                kind: 'corrected',
                sourceIds: ['correction-1'],
                previousSourceIds: ['src-1'],
              }
            : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('graded');
      if (result.scientific.state === 'graded') {
        expect(result.scientific.grade).toBe('A');
      }
    });

    it('refuses with unusable_observation for uncertain observation', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'sugars'
            ? {
                field: 'sugars',
                value: 5,
                unit: 'g',
                basis: 'per_100_g',
                kind: 'uncertain',
                sourceIds: ['src-1'],
                issues: [
                  {
                    code: 'blurred_panel',
                    stage: 'capture',
                    message: 'Panel is blurry',
                    action: 'retake',
                  },
                ],
              }
            : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unusable_observation',
          field: 'sugars',
        }),
      );
    });

    it('refuses with unusable_observation for estimated observation', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'protein'
            ? {
                field: 'protein',
                value: 8,
                unit: 'g',
                basis: 'per_100_g',
                kind: 'estimated',
                sourceIds: ['src-1'],
                issues: [],
                modelId: 'estimator-1',
                modelVersion: '1.0',
              }
            : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unusable_observation',
          field: 'protein',
        }),
      );
    });

    it('refuses with unusable_observation for missing observation', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'fibre'
            ? {
                field: 'fibre',
                kind: 'missing',
                reason: 'not_declared',
                issues: [],
              }
            : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unusable_observation',
          field: 'fibre',
        }),
      );
    });

    it('refuses with unusable_observation when read observation has issues', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'salt'
            ? {
                ...obs,
                issues: [
                  {
                    code: 'flagged_value',
                    stage: 'extraction',
                    message: 'Suspicious decimal placement',
                    action: 'edit',
                  },
                ],
              }
            : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unusable_observation',
          field: 'salt',
        }),
      );
    });

    it('refuses with unusable_observation when observation source does not resolve', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'saturates'
            ? {
                ...obs,
                sourceIds: ['unknown-source-1'],
              }
            : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unusable_observation',
          field: 'saturates',
        }),
      );
    });
  });

  describe('duplicate required observations', () => {
    it('refuses with conflicting_<field> when two equal read observations exist', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const energyObs = base.observations.find((o) => o.field === 'energy');
      if (!energyObs) throw new Error('Expected fixture energy');
      const snapshot: ProductSnapshot = {
        ...base,
        observations: [...base.observations, { ...energyObs }],
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'conflicting_energy',
          field: 'energy',
        }),
      );
    });

    it('refuses when duplicate observations are mixed (usable read + unusable uncertain)', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: [
          ...base.observations,
          {
            field: 'sugars',
            value: 12,
            unit: 'g',
            basis: 'per_100_g',
            kind: 'uncertain',
            sourceIds: ['src-1'],
            issues: [
              {
                code: 'uncertain_ocr',
                stage: 'capture',
                message: 'OCR uncertain',
                action: 'edit',
              },
            ],
          },
        ],
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'conflicting_sugars',
          field: 'sugars',
        }),
      );
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unusable_observation',
          field: 'sugars',
        }),
      );
    });
  });

  describe('unit and basis validation', () => {
    it('refuses with unsupported_unit via calculation engine', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'energy' ? { ...obs, unit: 'g' } : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_unit',
          field: 'energy',
        }),
      );
    });

    it('refuses with unsupported_basis via calculation engine', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'sugars' ? { ...obs, basis: 'per_serving' } : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'unsupported_basis',
          field: 'sugars',
        }),
      );
    });
  });

  describe('numeric zero handling', () => {
    it('preserves 0 as a measured numeric value rather than missing', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        observations: base.observations.map<NutrientObservation>((obs) =>
          obs.field === 'sugars' ? { ...obs, value: 0 } : obs,
        ),
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('graded');
      if (result.scientific.state === 'graded') {
        const sugarsTrace = result.scientific.trace?.find(
          (t) => t.component === 'sugars',
        );
        expect(sugarsTrace).toBeDefined();
        expect(sugarsTrace?.points).toBe(0);
      }
    });
  });

  describe('plain water semantics and conflicts', () => {
    it.each(['missing', 'duplicate'])(
      'keeps %s nutrient records non-blocking for supported water',
      (recordKind) => {
        const snapshot = buildSyntheticSnapshot(
          getVector('vector-beverage-water'),
        );
        snapshot.observations =
          recordKind === 'missing'
            ? [
                {
                  field: 'energy',
                  kind: 'missing',
                  reason: 'not_declared',
                  issues: [],
                },
              ]
            : [0, 0].map<NutrientObservation>((value) => ({
                field: 'energy',
                kind: 'read',
                value,
                unit: 'kJ',
                basis: 'per_100_ml',
                sourceIds: ['src-1'],
                issues: [],
              }));
        expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
        const result = replayScientificSnapshot(snapshot);
        expect(result.scientific.state).toBe('graded');
        expect(result.scientific).toMatchObject({ grade: 'A', score: 0 });
        expect(result.issues).toContainEqual(
          expect.objectContaining({
            code:
              recordKind === 'missing'
                ? 'unusable_observation'
                : 'conflicting_energy',
          }),
        );
      },
    );

    it('grades plain water as Grade A without requiring nutrient observations', () => {
      const waterVector = getVector('vector-beverage-water');
      const snapshot = buildSyntheticSnapshot(waterVector);

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('graded');
      if (result.scientific.state === 'graded') {
        expect(result.scientific.grade).toBe('A');
        expect(result.scientific.score).toBe(0);
      }
    });

    it('refuses with conflicting_water_facts when plain water has non-zero nutrients', () => {
      const waterVector = getVector('vector-beverage-water');
      const base = buildSyntheticSnapshot(waterVector);
      const snapshot: ProductSnapshot = {
        ...base,
        observations: [
          {
            field: 'energy',
            value: 150,
            unit: 'kJ',
            basis: 'per_100_ml',
            kind: 'read',
            sourceIds: ['src-1'],
            issues: [],
          },
        ],
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('insufficient_data');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'conflicting_water_facts',
          field: 'plainWater',
        }),
      );
    });

    it('permits plain water with zero-valued nutrient observations', () => {
      const waterVector = getVector('vector-beverage-water');
      const base = buildSyntheticSnapshot(waterVector);
      const snapshot: ProductSnapshot = {
        ...base,
        observations: [
          {
            field: 'energy',
            value: 0,
            unit: 'kJ',
            basis: 'per_100_ml',
            kind: 'read',
            sourceIds: ['src-1'],
            issues: [],
          },
          {
            field: 'sugars',
            value: 0,
            unit: 'g',
            basis: 'per_100_ml',
            kind: 'read',
            sourceIds: ['src-1'],
            issues: [],
          },
        ],
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('graded');
      if (result.scientific.state === 'graded') {
        expect(result.scientific.grade).toBe('A');
      }
    });
  });

  describe('resource mismatch', () => {
    it('refuses with method_unavailable when evidenceVersion does not match', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const snapshot: ProductSnapshot = {
        ...base,
        evidenceVersion: 'incompatible-version-999',
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.state).toBe('method_unavailable');
      expect(result.scientific.issues).toContainEqual(
        expect.objectContaining({
          code: 'incompatible_resources',
          stage: 'method',
          field: 'resources',
        }),
      );
    });
  });

  describe('snapshot identity and immutability', () => {
    it('propagates snapshot.id to scientific.inputSnapshotId', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const customId = 'snap-custom-uuid-987654';
      const snapshot: ProductSnapshot = {
        ...base,
        id: customId,
      };

      const result = replayScientificSnapshot(snapshot);
      expect(result.scientific.inputSnapshotId).toBe(customId);
    });

    it('is deterministic and does not mutate frozen input snapshot', () => {
      const base = buildSyntheticSnapshot(getVector(0));
      const before = JSON.stringify(base);
      deepFreeze(base);

      const first = replayScientificSnapshot(base);
      const second = replayScientificSnapshot(base);

      expect(first).toEqual(second);
      expect(JSON.stringify(base)).toBe(before);
    });
  });
});
