import { describe, expect, it } from '@jest/globals';
import vectorsJson from '../../../resources/vectors/nutriscore-vectors.json';
import { calculateNutriScore } from './nutri-score';
import type {
  FactState,
  NutriScoreInput,
  NutriScoreNutrient,
  ScoringFactName,
} from './types';

/**
 * Shared canonical vectors (resources/vectors/nutriscore-vectors.json), also
 * used by the backend (BE-12), so phone and server must agree on every one.
 *
 * The vectors' trace ruleLocator strings are prose summaries, so the trace is
 * compared by component and points; grade, score, route, method identity and
 * refusal issues are compared exactly.
 */

interface VectorObservation {
  field: string;
  value: number;
  unit: string;
  basis: string;
}

interface Vector {
  id: string;
  inputs: {
    category: string;
    flags: Record<ScoringFactName, boolean | FactState>;
    observations: VectorObservation[];
  };
  expectedAssessment: {
    state: string;
    grade?: string;
    score?: number;
    route?: string;
    method?: Record<string, string>;
    trace?: { component: string; points: number }[];
    issues: Record<string, string>[];
  };
}

const vectors = (vectorsJson as unknown as { vectors: Vector[] }).vectors;

/** Vector flags use booleans for known facts; the calculator uses states. */
function toState(flag: boolean | FactState): FactState {
  if (flag === true) {
    return 'present';
  }
  if (flag === false) {
    return 'absent';
  }
  return flag;
}

export function vectorInput(vector: Vector): NutriScoreInput {
  const { flags } = vector.inputs;
  const nutrients: Partial<Record<NutriScoreNutrient, unknown>> = {};
  for (const observation of vector.inputs.observations) {
    nutrients[observation.field as NutriScoreNutrient] = {
      value: observation.value,
      unit: observation.unit,
      basis: observation.basis,
    };
  }
  // Cast: vector JSON is untyped; the calculator validates the runtime shape.
  return {
    category: vector.inputs.category,
    facts: {
      cheese: toState(flags.cheese),
      redMeat: toState(flags.redMeat),
      plainWater: toState(flags.plainWater),
      nonNutritiveSweetener: toState(flags.nonNutritiveSweetener),
    },
    nutrients,
  } as NutriScoreInput;
}

describe('canonical Nutri-Score vectors', () => {
  it('covers all 15 pinned vectors', () => {
    expect(vectors).toHaveLength(15);
  });

  it.each(vectors.map((vector) => [vector.id, vector] as const))(
    '%s',
    (_id, vector) => {
      const expected = vector.expectedAssessment;
      const result = calculateNutriScore(vectorInput(vector));
      expect(result.state).toBe(expected.state);
      if (result.state === 'graded') {
        expect(result.grade).toBe(expected.grade);
        expect(result.score).toBe(expected.score);
        expect(result.route).toBe(expected.route);
        expect(result.method).toEqual(expected.method);
        const points = Object.fromEntries(
          result.trace.map((step) => [step.component, step.points]),
        );
        for (const step of expected.trace ?? []) {
          expect([step.component, points[step.component]]).toEqual([
            step.component,
            step.points,
          ]);
        }
      } else {
        expect(result.issues).toEqual(expected.issues);
      }
    },
  );
});
