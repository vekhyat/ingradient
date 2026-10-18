import Ajv from 'ajv';

import {
  NUTRIENT_FIELDS,
  type Basis,
  type NutrientField,
} from '../../domain/nutrition';

export const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export type Split = 'dev' | 'holdout';
export interface SplitManifest {
  dev: string[];
  holdout: string[];
}
export interface RunConfig {
  runId: string;
  pipelineRevision: string;
  split: Split;
  /** Required for holdout: identify the frozen candidate before opening results. */
  freeze: string;
}
export interface GroundTruth {
  ingredientsText: string | null;
  nutrition: {
    field: NutrientField;
    value: number;
    unit: 'g' | 'mg' | 'kJ' | 'kcal' | 'percent';
    basis: Basis;
  }[];
}

const ajv = new Ajv({ allErrors: true });
const ids = {
  type: 'array',
  minItems: 1,
  uniqueItems: true,
  items: { type: 'string', pattern: SAFE_ID.source },
};
const isSplit = ajv.compile<SplitManifest>({
  type: 'object',
  additionalProperties: false,
  required: ['dev', 'holdout'],
  properties: { dev: ids, holdout: ids },
});
const isRun = ajv.compile<RunConfig>({
  type: 'object',
  additionalProperties: false,
  required: ['runId', 'pipelineRevision', 'split', 'freeze'],
  properties: {
    runId: { type: 'string', pattern: SAFE_ID.source },
    pipelineRevision: { type: 'string', minLength: 1 },
    split: { enum: ['dev', 'holdout'] },
    freeze: { type: 'string' },
  },
});
const isGold = ajv.compile<GroundTruth>({
  type: 'object',
  additionalProperties: false,
  required: ['ingredientsText', 'nutrition'],
  properties: {
    ingredientsText: { type: ['string', 'null'] },
    nutrition: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['field', 'value', 'unit', 'basis'],
        properties: {
          field: { enum: Object.values(NUTRIENT_FIELDS) },
          value: { type: 'number', minimum: 0 },
          unit: { enum: ['g', 'mg', 'kJ', 'kcal', 'percent'] },
          basis: { enum: ['per_100_g', 'per_100_ml', 'per_serving'] },
        },
      },
    },
  },
});

export function parseSplit(value: unknown): SplitManifest {
  if (!isSplit(value))
    throw new Error(
      'Invalid split.json: nonempty, unique safe IDs required in dev and holdout.',
    );
  if (value.dev.some((id) => value.holdout.includes(id)))
    throw new Error('A photo cannot belong to both splits.');
  return value;
}

export function parseRun(value: unknown): RunConfig {
  if (!isRun(value))
    throw new Error(
      'Invalid run.json: runId, pipelineRevision, split and freeze required.',
    );
  if (value.split === 'holdout' && !value.freeze.trim())
    throw new Error('Freeze the pipeline before running holdout.');
  return value;
}

export function parseGroundTruth(value: unknown): GroundTruth {
  if (!isGold(value))
    throw new Error(
      'Invalid human transcription: check ingredient text, nutrition field, value, unit and basis.',
    );
  const keys = value.nutrition.map((row) => `${row.field}:${row.basis}`);
  if (new Set(keys).size !== keys.length)
    throw new Error('Duplicate ground-truth nutrient/basis.');
  return value;
}
