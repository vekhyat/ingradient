import { describe, expect, it } from '@jest/globals';
import { calculateNutriScore } from '../scientific';
import type { NutriScoreInput } from '../scientific';
import { localValidators } from '../contracts';
import type { ScientificReason } from '../contracts/generated/local';
import { renderBackendReasons, renderScientificAssessment } from './index';

const input: NutriScoreInput = {
  category: 'general',
  facts: {
    cheese: 'absent',
    redMeat: 'absent',
    plainWater: 'absent',
    nonNutritiveSweetener: 'absent',
  },
  nutrients: {
    energy: { value: 450, unit: 'kJ', basis: 'per_100_g' },
    sugars: { value: 4, unit: 'g', basis: 'per_100_g' },
    saturates: { value: 0.5, unit: 'g', basis: 'per_100_g' },
    salt: { value: 0.8, unit: 'g', basis: 'per_100_g' },
    protein: { value: 6, unit: 'g', basis: 'per_100_g' },
    fibre: { value: 4.5, unit: 'g', basis: 'per_100_g' },
    fvl: { value: 65, unit: 'percent', basis: 'per_100_g' },
  },
};

describe('reviewed evidence rendering', () => {
  it('serializes actual calculation into a valid cited contract assessment', () => {
    const result = renderScientificAssessment(
      calculateNutriScore(input),
      'snapshot-1',
    );
    expect(result.scientific.state).toBe('graded');
    expect(localValidators.ScientificAssessment(result.scientific)).toBe(true);
    expect(
      result.scientific.reasons.every((r) =>
        r.citationIds.every((id) => result.citations.some((c) => c.id === id)),
      ),
    ).toBe(true);
    expect(
      result.scientific.reasons.find(
        (r) => r.templateId === 'nutriscore.energy',
      )?.text,
    ).toContain('450 kJ');
  });
  it('renders deterministic text and metadata', () => {
    expect(
      renderScientificAssessment(calculateNutriScore(input), 'snapshot-1'),
    ).toEqual(
      renderScientificAssessment(calculateNutriScore(input), 'snapshot-1'),
    );
  });
  it('never displays supplied server text', () => {
    const replay = renderScientificAssessment(
      calculateNutriScore(input),
      'snapshot-1',
    );
    const server = replay.scientific.reasons.map((r) => ({
      ...r,
      text: 'UNTRUSTED HEALTH PROMISE',
    }));
    const result = renderBackendReasons(server, replay);
    expect(result.issues).toEqual([]);
    expect(result.reasons).toEqual(replay.scientific.reasons);
    expect(result.reasons.some((r) => r.text.includes('UNTRUSTED'))).toBe(
      false,
    );
  });
  it('drops unknown template with a named issue', () => {
    const replay = renderScientificAssessment(
      calculateNutriScore(input),
      'snapshot-1',
    );
    const first = replay.scientific.reasons[0];
    if (!first) throw new Error('Expected real calculation evidence');
    const result = renderBackendReasons(
      [{ ...first, templateId: 'invented.health', text: 'UNTRUSTED' }],
      replay,
    );
    expect(result.reasons).toEqual([]);
    expect(result.issues[0]?.code).toBe('unknown_reason_template');
  });
  it('refuses a known template without corresponding replay evidence', () => {
    const replay = renderScientificAssessment(
      calculateNutriScore(input),
      'snapshot-1',
    );
    const first = replay.scientific.reasons[0];
    if (!first) throw new Error('Expected real calculation evidence');
    expect(
      renderBackendReasons([{ ...first, step: 'invented-step' }], replay)
        .issues[0]?.code,
    ).toBe('reason_evidence_mismatch');
  });
  it.each(['different inputs', 'missing inputs', 'extra citation'])(
    'refuses a known template with %s',
    (mismatch) => {
      const replay = renderScientificAssessment(
        calculateNutriScore(input),
        'snapshot-1',
      );
      const first = replay.scientific.reasons[0];
      if (!first) throw new Error('Expected real calculation evidence');
      const server: ScientificReason = {
        ...first,
        inputFields:
          mismatch === 'different inputs'
            ? ['unrelated.field']
            : mismatch === 'missing inputs'
              ? []
              : first.inputFields,
        citationIds:
          mismatch === 'extra citation'
            ? [
                first.citationIds[0],
                ...first.citationIds.slice(1),
                'invented-source',
              ]
            : first.citationIds,
      };
      const result = renderBackendReasons([server], replay);
      expect(result.reasons).toEqual([]);
      expect(result.issues.map((issue) => issue.code)).toEqual([
        'reason_evidence_mismatch',
      ]);
    },
  );
  it('accepts reordered references and uses the local text and reference order', () => {
    const replay = renderScientificAssessment(
      calculateNutriScore(input),
      'snapshot-1',
    );
    const server = replay.scientific.reasons.map<ScientificReason>(
      (reason) => ({
        ...reason,
        text: 'UNTRUSTED',
        inputFields: [...reason.inputFields].reverse(),
        citationIds: [
          reason.citationIds[reason.citationIds.length - 1] ??
            reason.citationIds[0],
          ...reason.citationIds.slice(0, -1).reverse(),
        ],
      }),
    );
    expect(renderBackendReasons(server, replay)).toEqual({
      reasons: replay.scientific.reasons,
      issues: [],
    });
  });
  it('renders supported plain water with the water template', () => {
    const water: NutriScoreInput = {
      category: 'beverage',
      facts: { ...input.facts, plainWater: 'present' },
      nutrients: {},
    };
    const result = renderScientificAssessment(
      calculateNutriScore(water),
      'water-1',
    );
    expect(result.scientific.state).toBe('graded');
    expect(result.scientific.reasons[0]?.templateId).toBe(
      'nutriscore.water_classification',
    );
    expect(result.scientific.reasons[0]?.text).toContain(
      'Grade A automatically',
    );
  });
  it('does not claim conditional protein is subtracted', () => {
    const high: NutriScoreInput = {
      ...input,
      nutrients: {
        ...input.nutrients,
        energy: { value: 1600, unit: 'kJ', basis: 'per_100_g' },
        saturates: { value: 10, unit: 'g', basis: 'per_100_g' },
        salt: { value: 1.5, unit: 'g', basis: 'per_100_g' },
        protein: { value: 20, unit: 'g', basis: 'per_100_g' },
        fvl: { value: 0, unit: 'percent', basis: 'per_100_g' },
      },
    };
    const result = renderScientificAssessment(
      calculateNutriScore(high),
      'high-1',
    );
    expect(result.scientific.state).toBe('graded');
    expect(
      result.scientific.reasons.find(
        (r) => r.templateId === 'nutriscore.protein_not_counted',
      )?.text,
    ).toContain('not subtracted');
  });
  it('keeps unsupported data unavailable without invented reasons', () => {
    const result = renderScientificAssessment(
      calculateNutriScore({ ...input, nutrients: {} }),
      'missing-1',
    );
    expect(result.scientific.state).toBe('insufficient_data');
    expect(result.scientific.reasons).toEqual([]);
  });
});
