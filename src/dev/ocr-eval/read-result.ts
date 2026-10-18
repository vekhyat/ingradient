import Ajv from 'ajv';

import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { validateProductSnapshot } from '../../domain/contracts/generated/validate-local';
import type { LabelPanels } from '../../features/capture/label-panels';
import type { OcrOutcome } from '../../features/capture/ocr-page';
import { parseRun, SAFE_ID } from './dataset';
import type { EvalResult } from './pipeline';

const ajv = new Ajv();
const rectangle = {
  type: 'object',
  required: ['x', 'y', 'width', 'height'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number', minimum: 0 },
    height: { type: 'number', minimum: 0 },
  },
};
const box = { anyOf: [{ type: 'null' }, rectangle] };
const isOutcome = ajv.compile<OcrOutcome>({
  anyOf: [
    {
      type: 'object',
      required: ['status', 'page'],
      properties: {
        status: { const: 'read' },
        page: {
          type: 'object',
          required: ['blocks'],
          properties: {
            blocks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['text', 'box', 'lines'],
                properties: {
                  text: { type: 'string' },
                  box,
                  lines: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['text', 'box', 'languages'],
                      properties: {
                        text: { type: 'string' },
                        box,
                        languages: { type: 'array', items: { type: 'string' } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    {
      type: 'object',
      required: ['status'],
      properties: { status: { const: 'no_text' } },
    },
    {
      type: 'object',
      required: ['status', 'script'],
      properties: {
        status: { const: 'unsupported_language' },
        script: { type: 'string' },
      },
    },
    {
      type: 'object',
      required: ['status', 'message'],
      properties: {
        status: { const: 'engine_error' },
        message: { type: 'string' },
      },
    },
  ],
});
const isPanels = ajv.compile<LabelPanels>({
  type: 'object',
  required: ['ingredientsText', 'nutritionFragments'],
  properties: {
    ingredientsText: { type: ['string', 'null'] },
    nutritionFragments: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'box'],
        properties: {
          text: { type: 'string' },
          box: rectangle,
          lineId: { type: 'string' },
          blockId: { type: 'string' },
        },
      },
    },
  },
});

export function jsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a JSON object.');
  return value as Record<string, unknown>;
}

/** Score the stored baseline, even after the current production parser changes. */
export function parseEvalResult(value: unknown): EvalResult {
  const saved = jsonObject(value);
  const run = parseRun(saved.run);
  if (
    saved.schemaVersion !== 1 ||
    typeof saved.id !== 'string' ||
    !SAFE_ID.test(saved.id) ||
    typeof saved.imageSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(saved.imageSha256) ||
    typeof saved.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(saved.capturedAt)) ||
    typeof saved.elapsedMs !== 'number' ||
    !Number.isFinite(saved.elapsedMs) ||
    saved.elapsedMs < 0 ||
    !isOutcome(saved.outcome) ||
    !isPanels(saved.panels) ||
    !validateProductSnapshot(saved.snapshot)
  ) {
    throw new Error(
      'Invalid device result: metadata, OCR, panels or snapshot failed validation.',
    );
  }
  return {
    schemaVersion: 1,
    id: saved.id,
    run,
    imageSha256: saved.imageSha256,
    capturedAt: saved.capturedAt,
    elapsedMs: saved.elapsedMs,
    outcome: saved.outcome,
    panels: saved.panels,
    // The generated frozen-contract validator above validates this boundary.
    snapshot: saved.snapshot as ProductSnapshot,
  };
}
