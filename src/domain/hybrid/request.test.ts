import { describe, expect, it } from '@jest/globals';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import { join } from 'path';

import type {
  Issue,
  NutrientObservation,
  ProductSnapshot,
} from '../contracts/generated/local';
import {
  NO_CORRECTIONS,
  buildLabelSnapshot,
  type Corrections,
} from '../../features/capture/label-snapshot';
import { getLocalScenario } from '../../fixtures/scenarios';
import {
  ANALYSIS_FALLBACK_START_MS,
  ANALYSIS_REQUEST_LIFETIME_MS,
  MAX_REQUEST_BYTES,
  WIRE_CONTRACT_VERSION,
} from './constants';
import { buildAnalyzeRequest } from './request';
import { installedResources } from './resources';

const ROOT = join(__dirname, '..', '..', '..');
const base = getLocalScenario('complete_graded').snapshot;
const resources = installedResources();

function build(snapshot: ProductSnapshot) {
  const built = buildAnalyzeRequest(snapshot, resources);
  if (!built.ok) {
    throw new Error(built.issue.message);
  }
  return built;
}

describe('buildAnalyzeRequest (HYB-01 case 1)', () => {
  const extractionIssue: Issue = {
    code: 'ocr_confidence_low',
    stage: 'extraction',
    field: 'energy',
    message: 'The printed value needs review.',
    action: 'edit',
  };

  it.each(['read', 'corrected', 'uncertain', 'missing'] as const)(
    'preserves extraction issues on %s observations',
    (kind) => {
      const [first] = base.observations;
      if (!first || first.kind !== 'read') {
        throw new Error('fixture needs a read observation');
      }
      const observation: NutrientObservation =
        kind === 'missing'
          ? {
              field: first.field,
              kind,
              reason: 'unreadable',
              issues: [extractionIssue],
            }
          : kind === 'corrected'
            ? {
                ...first,
                kind,
                previousSourceIds: first.sourceIds,
                issues: [extractionIssue],
              }
            : { ...first, kind, issues: [extractionIssue] };
      const sent = build({ ...base, observations: [observation] }).request
        .product.observations;
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ kind, issues: [extractionIssue] });
    },
  );

  it.each(['read', 'corrected'] as const)(
    'omits %s observations when any issue cannot travel',
    (kind) => {
      const [first] = base.observations;
      if (!first || first.kind !== 'read') {
        throw new Error('fixture needs a read observation');
      }
      for (const stage of ['personal', 'storage'] as const) {
        for (const issues of [
          [{ ...extractionIssue, stage }],
          [extractionIssue, { ...extractionIssue, stage }],
        ]) {
          const observation: NutrientObservation =
            kind === 'corrected'
              ? { ...first, kind, previousSourceIds: first.sourceIds, issues }
              : { ...first, kind, issues };
          expect(
            build({ ...base, observations: [observation] }).request.product
              .observations,
          ).toEqual([]);
        }
      }
    },
  );

  it('builds a schema-valid, product-only body', () => {
    const built = build(base);
    const parsed = JSON.parse(built.body) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual([
      'contractVersion',
      'product',
      'resourceCompatibility',
    ]);
    expect(built.request.contractVersion).toBe(WIRE_CONTRACT_VERSION);
    expect(built.request.resourceCompatibility).toEqual(resources);
    expect(built.request.product.ingredientsStatus).toBe('complete');
  });

  it('cannot serialise profile, allergy, learning, image or panel data', () => {
    const tainted = {
      ...base,
      profile: { allergies: ['peanut'], pregnancy: true },
      learning: [{ liked: 'sugar' }],
      photoUri: 'file:///label.jpg',
    } as ProductSnapshot;
    const { body } = build(tainted);
    for (const leak of [
      'peanut',
      'pregnancy',
      'learning',
      'file:///',
      'img-1',
      'reg-ing',
      'imageId',
      'regionId',
      'capturedAt',
      base.id,
    ]) {
      expect(body).not.toContain(leak);
    }
  });

  it('relabels sources src-N, uniquely, with catalogue titles', () => {
    const snapshot: ProductSnapshot = {
      ...base,
      sourceRefs: [
        {
          id: 'off:8901030000001',
          kind: 'off',
          title: 'Open Food Facts',
          edition: 'retrieved-2026-10-16T09:30:12.345Z',
        },
        {
          id: 'label-photo-7',
          kind: 'label',
          title: 'Nutrition table on your label photo',
        },
        { id: 'model-1', kind: 'model', title: 'Estimate' },
        { id: 'off:8901030000001', kind: 'off', title: 'duplicate' },
      ],
      observations: base.observations.map((observation): NutrientObservation =>
        observation.kind === 'missing'
          ? observation
          : { ...observation, sourceIds: ['label-photo-7'] },
      ),
      ingredients: base.ingredients.map((mention) => ({
        ...mention,
        sourceIds: ['off:8901030000001'],
      })),
    };
    const { request } = build(snapshot);
    expect(request.product.sourceRefs).toEqual([
      {
        id: 'src-0',
        kind: 'off',
        title: 'Open Food Facts product',
        edition: '2026-10-16T09:30:12Z',
      },
      { id: 'src-1', kind: 'label', title: 'Nutrition panel' },
    ]);
    for (const observation of request.product.observations) {
      if (observation.kind !== 'missing') {
        expect(observation.sourceIds).toEqual(['src-1']);
      }
    }
  });

  it('never sends model estimates or observations without a sendable source', () => {
    const [first] = base.observations;
    if (!first || first.kind === 'missing') {
      throw new Error('fixture needs a read observation');
    }
    const snapshot: ProductSnapshot = {
      ...base,
      sourceRefs: [
        ...base.sourceRefs,
        { id: 'model-1', kind: 'model', title: 'Estimate' },
      ],
      observations: [
        {
          ...first,
          field: 'fibre',
          kind: 'estimated',
          modelId: 'm',
          modelVersion: '1',
          sourceIds: ['model-1'],
        },
        { ...first, field: 'protein', sourceIds: ['model-1'] },
        first,
      ],
    };
    const fields = build(snapshot).request.product.observations.map(
      (item) => item.field,
    );
    expect(fields).toEqual([first.field]);
  });

  it('omits an unknown category and keeps unsendable facts unknown (ADR013)', () => {
    const unknown = build({
      ...base,
      category: 'unknown',
      scoringFacts: undefined,
    });
    expect('category' in unknown.request.product).toBe(false);
    expect('scoringFacts' in unknown.request.product).toBe(false);

    const facts = build({
      ...base,
      sourceRefs: [
        ...base.sourceRefs,
        { id: 'official-1', kind: 'official', title: 'Report' },
      ],
      scoringFacts: {
        categorySourceIds: ['src-0'],
        cheese: { state: 'absent', sourceIds: ['official-1'] },
        redMeat: { state: 'absent', sourceIds: ['src-0'] },
        plainWater: { state: 'unknown' },
        nonNutritiveSweetener: { state: 'present', sourceIds: ['missing-id'] },
      },
    }).request.product.scoringFacts;
    expect(facts).toEqual({
      categorySourceIds: ['src-0'],
      cheese: { state: 'unknown' },
      redMeat: { state: 'absent', sourceIds: ['src-0'] },
      plainWater: { state: 'unknown' },
      nonNutritiveSweetener: { state: 'unknown' },
    });
  });

  it('maps ingredient panel states without inventing completeness', () => {
    const withPanel = (
      state: 'read' | 'uncertain' | 'missing',
      text?: string,
    ) =>
      build({
        ...base,
        panels: base.panels.map((panel) =>
          panel.panel === 'ingredients' ? { ...panel, state, text } : panel,
        ),
      }).request.product;
    expect(withPanel('uncertain', 'oats, sugar')).toMatchObject({
      ingredientsStatus: 'partial',
      ingredientsText: 'oats, sugar',
    });
    expect(withPanel('read', '   ')).toMatchObject({
      ingredientsStatus: 'missing',
      ingredientsText: null,
    });
    expect(withPanel('missing')).toMatchObject({
      ingredientsStatus: 'missing',
    });
  });

  it('refuses a body over the contract size bound', () => {
    const built = buildAnalyzeRequest(
      {
        ...base,
        panels: base.panels.map((panel) =>
          panel.panel === 'ingredients'
            ? { ...panel, text: 'x'.repeat(MAX_REQUEST_BYTES) }
            : panel,
        ),
      },
      resources,
    );
    expect(built.ok).toBe(false);
  });
});

describe('frozen contract drift', () => {
  const contract = load(
    readFileSync(join(ROOT, 'contracts', 'openapi-hybrid.yaml'), 'utf8'),
  ) as {
    info: { version: string };
    'x-draft-client-policy': { analysisFallbackStartMs: number };
    'x-draft-operating-limits': {
      analysisRequestLifetimeMs: number;
      maxRequestBytes: number;
    };
  };

  it('uses the timers and limits frozen in contracts/', () => {
    expect(ANALYSIS_FALLBACK_START_MS).toBe(
      contract['x-draft-client-policy'].analysisFallbackStartMs,
    );
    expect(ANALYSIS_REQUEST_LIFETIME_MS).toBe(
      contract['x-draft-operating-limits'].analysisRequestLifetimeMs,
    );
    expect(MAX_REQUEST_BYTES).toBe(
      contract['x-draft-operating-limits'].maxRequestBytes,
    );
    expect(WIRE_CONTRACT_VERSION).toBe(contract.info.version);
  });

  it('names the editions the backend derives from the same pinned files', () => {
    const manifest = JSON.parse(
      readFileSync(join(ROOT, 'resources', 'manifest.json'), 'utf8'),
    ) as { revision: string };
    const templates = JSON.parse(
      readFileSync(
        join(ROOT, 'resources', 'evidence', 'reason-templates.json'),
        'utf8',
      ),
    ) as { evidenceEdition: string };
    expect(resources.taxonomyVersion).toBe(
      `off-taxonomy-ingredients@${manifest.revision}`,
    );
    expect(resources.evidenceVersion).toBe(templates.evidenceEdition);
    // Method identity and evidence edition stay distinct.
    expect(resources.evidenceVersion).not.toBe(resources.methodEdition);
  });

  it('names the method bundle hash of the installed file', () => {
    const bytes = readFileSync(
      join(ROOT, 'resources', 'method', 'nutriscore-updated-2023.json'),
    );
    expect(bytesToHex(sha256(new Uint8Array(bytes)))).toBe(
      resources.methodBundleSha256,
    );
  });
});

describe('corrected ingredients', () => {
  const labelSnapshot = (corrections: Corrections) =>
    buildLabelSnapshot({
      session: {
        id: 's1',
        barcode: null,
        photos: [],
        ingredients: {
          state: 'read',
          imageId: 'p1',
          text: 'Ingredients: chocolate (sugar, cocoa), rice, salt.',
        },
        nutrition: { state: 'missing', imageId: null, fragments: [] },
      },
      corrections,
      capturedAt: '2026-10-20T10:00:00.000Z',
      base: null,
    });
  const idOf = (snapshot: ProductSnapshot, text: string) => {
    const id = snapshot.ingredients.find((m) => m.text === text)?.id;
    if (!id) throw new Error(`fixture has ${text}`);
    return id;
  };

  it('sends the photographed text when nothing was corrected', () => {
    const product = build(labelSnapshot(NO_CORRECTIONS)).request.product;
    expect(product.ingredientsText).toBe(
      'Ingredients: chocolate (sugar, cocoa), rice, salt.',
    );
    expect(product.ingredientsStatus).toBe('complete');
  });

  it('sends the reviewed list, without unreadable readings', () => {
    const plain = labelSnapshot(NO_CORRECTIONS);
    const snapshot = labelSnapshot({
      ingredients: {
        [idOf(plain, 'rice')]: { kind: 'text', text: 'oats' },
        [idOf(plain, 'salt')]: { kind: 'unreadable' },
      },
      nutrients: {},
    });
    const product = build(snapshot).request.product;
    expect(product.ingredientsText).toBe('chocolate (sugar, cocoa), oats');
    expect(product.ingredientsStatus).toBe('partial');
  });

  it('keeps sub-ingredients of an unreadable parent', () => {
    const plain = labelSnapshot(NO_CORRECTIONS);
    const product = build(
      labelSnapshot({
        ingredients: { [idOf(plain, 'chocolate')]: { kind: 'unreadable' } },
        nutrients: {},
      }),
    ).request.product;
    expect(product.ingredientsText).toBe('sugar, cocoa, rice, salt');
  });
});
