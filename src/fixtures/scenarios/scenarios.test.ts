/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localValidators } from '../../domain/contracts';
import {
  getLocalScenario,
  namedLocalScenarios,
  type LocalScenarioName,
} from './index';

const contractsDir = join(__dirname, '..', '..', '..', 'contracts');
const localSchema = JSON.parse(
  readFileSync(join(contractsDir, 'local-contract.schema.json'), 'utf8'),
) as Record<string, unknown>;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(localSchema, 'local-contract.schema.json');
const validateLookupOutcomeSchema = ajv.compile({
  $ref: 'local-contract.schema.json#/$defs/LookupOutcome',
});

describe('Named local scenarios (FE-04)', () => {
  const scenarioNames: LocalScenarioName[] = [
    'complete_graded',
    'missing_nutrients',
    'unsupported_category',
    'conflicting_sources',
    'throttled_lookup',
    'cancelled_scan',
  ];

  it('provides all 6 named local scenarios', () => {
    expect(Object.keys(namedLocalScenarios)).toHaveLength(6);
    for (const name of scenarioNames) {
      expect(namedLocalScenarios[name]).toBeDefined();
      expect(getLocalScenario(name)).toBe(namedLocalScenarios[name]);
    }
  });

  describe.each(scenarioNames)('scenario: %s', (name) => {
    const scenario = namedLocalScenarios[name];

    it('validates snapshot against local ProductSnapshot validator', () => {
      const valid = localValidators.ProductSnapshot(scenario.snapshot);
      expect(valid).toBe(true);
    });

    it('validates scientific assessment against local ScientificAssessment validator', () => {
      const valid = localValidators.ScientificAssessment(
        scenario.assessment.scientific,
      );
      expect(valid).toBe(true);
    });

    it('validates local assessment against local LocalAssessment validator', () => {
      const valid = localValidators.LocalAssessment(scenario.assessment);
      expect(valid).toBe(true);
    });

    it('validates lookupOutcome against local contract LookupOutcome schema', () => {
      const valid = validateLookupOutcomeSchema(scenario.lookupOutcome);
      expect(valid).toBe(true);
    });
  });

  it('complete_graded scenario has expected complete properties', () => {
    const scenario = namedLocalScenarios.complete_graded;
    expect(scenario.assessment.scientific.state).toBe('graded');
    if (scenario.assessment.scientific.state === 'graded') {
      expect(scenario.assessment.scientific.grade).toBe('C');
      expect(scenario.assessment.scientific.score).toBe(5);
      expect(scenario.assessment.scientific.route).toBe('general');
    }
    expect(scenario.snapshot.observations.length).toBeGreaterThanOrEqual(6);
    expect(scenario.lookupOutcome.state).toBe('found');
  });

  it('missing_nutrients scenario has missing fibre observation', () => {
    const scenario = namedLocalScenarios.missing_nutrients;
    expect(scenario.assessment.scientific.state).toBe('insufficient_data');
    const missingFibre = scenario.snapshot.observations.find(
      (obs) => obs.field === 'fibre' && obs.kind === 'missing',
    );
    expect(missingFibre).toBeDefined();
    expect(scenario.lookupOutcome.state).toBe('found');
  });

  it('unsupported_category scenario has excluded category', () => {
    const scenario = namedLocalScenarios.unsupported_category;
    expect(scenario.snapshot.category).toBe('excluded');
    expect(scenario.assessment.scientific.state).toBe('unsupported');
    expect(scenario.lookupOutcome.state).toBe('found');
  });

  it('conflicting_sources scenario has multiple sourceRefs and conflicting observations', () => {
    const scenario = namedLocalScenarios.conflicting_sources;
    expect(scenario.snapshot.sourceRefs).toHaveLength(2);
    expect(scenario.assessment.scientific.state).toBe('insufficient_data');
    const conflictingObs = scenario.snapshot.observations.find(
      (obs) => obs.kind === 'missing' && obs.reason === 'conflicting_sources',
    );
    expect(conflictingObs).toBeDefined();
  });

  it('throttled_lookup scenario has throttled state and retry cooldown', () => {
    const scenario = namedLocalScenarios.throttled_lookup;
    expect(scenario.lookupOutcome.state).toBe('throttled');
    if (scenario.lookupOutcome.state === 'throttled') {
      expect(scenario.lookupOutcome.retryAfterSeconds).toBe(60);
      expect(scenario.lookupOutcome.issues[0]?.code).toBe('lookup_throttled');
    }
  });

  it('cancelled_scan scenario has cancelled state and cancellation issue', () => {
    const scenario = namedLocalScenarios.cancelled_scan;
    expect(scenario.lookupOutcome.state).toBe('cancelled');
    if (scenario.lookupOutcome.state !== 'cancelled') {
      return;
    }
    expect(scenario.lookupOutcome.issues[0]?.code).toBe('scan_cancelled');
    expect(scenario.assessment.scientific.state).not.toBe('graded');
  });

  it('aligns snapshot, assessment, lookup, source and citation references', () => {
    for (const scenario of Object.values(namedLocalScenarios)) {
      expect(scenario.assessment.snapshotId).toBe(scenario.snapshot.id);
      expect(scenario.assessment.scientific.inputSnapshotId).toBe(
        scenario.snapshot.id,
      );
      if (scenario.lookupOutcome.state === 'found') {
        expect(scenario.lookupOutcome.snapshot.id).toBe(scenario.snapshot.id);
      }
      const sourceIds = new Set(
        scenario.snapshot.sourceRefs.map((source) => source.id),
      );
      for (const observation of scenario.snapshot.observations) {
        if (!('sourceIds' in observation)) {
          continue;
        }
        for (const sourceId of observation.sourceIds) {
          expect(sourceIds.has(sourceId)).toBe(true);
        }
      }
      for (const ingredient of scenario.snapshot.ingredients) {
        for (const sourceId of ingredient.sourceIds) {
          expect(sourceIds.has(sourceId)).toBe(true);
        }
      }
      const citationIds = new Set(
        scenario.assessment.citations.map((citation) => citation.id),
      );
      for (const reason of scenario.assessment.scientific.reasons) {
        for (const citationId of reason.citationIds) {
          expect(citationIds.has(citationId)).toBe(true);
        }
      }
      if (scenario.assessment.scientific.state === 'graded') {
        for (const step of scenario.assessment.scientific.trace) {
          for (const citationId of step.citationIds) {
            expect(citationIds.has(citationId)).toBe(true);
          }
        }
      }
    }
  });
});
