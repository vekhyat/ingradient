/**
 * @jest-environment node
 */
/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { load as loadYaml } from 'js-yaml';
import { localValidators } from './generated/validate-local';
import { wireValidators } from './generated/validate-wire';
import { validationDetail, validatorByName, type ContractValidator } from './validator-types';

const contractsDir = join(__dirname, '..', '..', '..', 'contracts');
const WIRE_ID = 'urn:ingradient:wire-contract:0.3.0-draft';

// Same roots as LOCAL_RUNTIME_ROOTS / WIRE_RUNTIME_ROOTS in codegen/generate.mjs.
const LOCAL_RUNTIME_ROOTS = [
  'LocalAssessment',
  'LocalLearningState',
  'LocalProfile',
  'ProductSnapshot',
  'ScientificAssessment',
];
const WIRE_RUNTIME_ROOTS = [
  'AnalyzeRequest',
  'AnalyzeResponse',
  'Health',
  'Problem',
  'ResourceManifest',
];

interface NegativeCase {
  name: string;
  schema: string;
  value: unknown;
}

function readNegative(filename: string): NegativeCase[] {
  const parsed: unknown = JSON.parse(readFileSync(join(contractsDir, 'negative', filename), 'utf8'));
  if (!Array.isArray(parsed)) {
    throw new Error(`${filename} must be an array.`);
  }
  return parsed.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${filename} has a non-object case.`);
    }
    const name = Reflect.get(entry, 'name');
    const schema = Reflect.get(entry, 'schema');
    if (typeof name !== 'string' || typeof schema !== 'string' || !('value' in entry)) {
      throw new Error(`${filename} case is missing name, schema, or value.`);
    }
    return { name, schema, value: Reflect.get(entry, 'value') };
  });
}

const localNegative = readNegative('local.json');
const wireNegative = readNegative('wire.json');

interface SchemaExample {
  side: 'local' | 'wire';
  schema: string;
  index: number;
  value: unknown;
}

function schemaExamples(definition: unknown): unknown[] {
  if (typeof definition !== 'object' || definition === null) {
    return [];
  }
  const values: unknown[] = [];
  const examples = Reflect.get(definition, 'examples');
  if (Array.isArray(examples)) {
    values.push(...examples);
  }
  if (Object.hasOwn(definition, 'example')) {
    values.push(Reflect.get(definition, 'example'));
  }
  return values;
}

function definitionsOf(document: unknown, label: string): Record<string, unknown> {
  if (typeof document !== 'object' || document === null) {
    throw new Error(`${label} must be an object.`);
  }
  const defs: unknown = Reflect.get(document, '$defs') ?? Reflect.get(document, 'schemas');
  if (typeof defs !== 'object' || defs === null || Array.isArray(defs)) {
    throw new Error(`${label} has no schema definitions.`);
  }
  const record: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(defs)) {
    record[name] = schema;
  }
  return record;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function wireDefinitions(): Record<string, unknown> {
  const spec = loadYaml(readFileSync(join(contractsDir, 'openapi-hybrid.yaml'), 'utf8'));
  const document = asRecord(spec, 'OpenAPI document');
  const components = asRecord(Reflect.get(document, 'components'), 'OpenAPI components');
  const schemas = asRecord(Reflect.get(components, 'schemas'), 'OpenAPI schemas');
  const rewritten: unknown = JSON.parse(
    JSON.stringify(schemas).replaceAll('#/components/schemas/', '#/$defs/'),
  );
  return asRecord(rewritten, 'wire schemas');
}

const localDocument = asRecord(
  JSON.parse(readFileSync(join(contractsDir, 'local-contract.schema.json'), 'utf8')),
  'local contract',
);
const localId = localDocument.$id;
if (typeof localId !== 'string') {
  throw new Error('Local contract is missing a string $id.');
}
const wireDefs = wireDefinitions();

function compileValidators(
  document: Record<string, unknown>,
  documentId: string,
): Record<string, ContractValidator> {
  const ajv = new Ajv2020({
    // Same strictness as codegen/generate.mjs. if/then uses properties
    // without type: object, which strictTypes would reject before checking data.
    strict: true,
    strictTypes: false,
    strictSchema: false,
    allErrors: true,
  });
  addFormats(ajv, ['date', 'date-time', 'uri']);
  ajv.addSchema({ ...document, $id: documentId });
  const defs = asRecord(Reflect.get(document, '$defs'), `${documentId} definitions`);
  const validators: Record<string, ContractValidator> = {};
  for (const name of Object.keys(defs)) {
    validators[name] = ajv.compile({ $ref: `${documentId}#/$defs/${name}` }) as ContractValidator;
  }
  return validators;
}

const compiledLocal = compileValidators(localDocument, localId);
const compiledWire = compileValidators(
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: wireDefs,
  },
  WIRE_ID,
);

function positiveExamples(): SchemaExample[] {
  const rows: SchemaExample[] = [];
  const sides = [
    ['local', definitionsOf(localDocument, 'local contract')],
    ['wire', wireDefs],
  ] as const;
  for (const [side, defs] of sides) {
    for (const [schema, definition] of Object.entries(defs)) {
      schemaExamples(definition).forEach((value, index) => {
        rows.push({ side, schema, index, value });
      });
    }
  }
  return rows;
}

function validatorsFor(side: SchemaExample['side']): Record<string, ContractValidator> {
  // Shipped roots overwrite the test-time compile, so those cases run the phone code.
  if (side === 'local') {
    return { ...compiledLocal, ...localValidators };
  }
  return { ...compiledWire, ...wireValidators };
}

describe('contract validators', () => {
  it('ships only the runtime roots', () => {
    expect(Object.keys(localValidators).sort()).toEqual(LOCAL_RUNTIME_ROOTS);
    expect(Object.keys(wireValidators).sort()).toEqual(WIRE_RUNTIME_ROOTS);
  });

  it('accepts every positive local and wire schema example', () => {
    const examples = positiveExamples();
    expect(examples.filter((example) => example.side === 'local').length).toBeGreaterThan(0);
    expect(examples.filter((example) => example.side === 'wire').length).toBeGreaterThan(0);
    for (const example of examples) {
      const validator: ContractValidator = validatorByName(validatorsFor(example.side), example.schema);
      expect({
        side: example.side,
        schema: example.schema,
        index: example.index,
        detail: validator(example.value) ? '' : validationDetail(validator),
      }).toEqual({
        side: example.side,
        schema: example.schema,
        index: example.index,
        detail: '',
      });
    }
  });

  it.each(localNegative)('rejects local case: $name', (testCase) => {
    const validator = validatorByName(validatorsFor('local'), testCase.schema);
    expect(validator(testCase.value)).toBe(false);
  });

  it.each(wireNegative)('rejects wire case: $name', (testCase) => {
    const validator = validatorByName(validatorsFor('wire'), testCase.schema);
    expect(validator(testCase.value)).toBe(false);
  });
});
