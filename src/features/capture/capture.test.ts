import { describe, expect, it } from '@jest/globals';

import { localValidators } from '../../domain/contracts/generated/validate-local';
import { splitLabelPanels } from './label-panels';
import {
  applyPhoto,
  createLabelSession,
  isReadyForReview,
  markPanelAbsent,
  missingPanels,
} from './label-session';
import { NO_CORRECTIONS, buildLabelSnapshot } from './label-snapshot';
import type { OcrBlock, OcrPage } from './ocr-page';

/** One OCR block per row of text, laid out top to bottom. */
function block(
  lines: readonly string[],
  y: number,
  x = 0,
  width = 300,
): OcrBlock {
  const height = 22;
  return {
    text: lines.join('\n'),
    box: { x, y, width, height: lines.length * (height + 8) },
    lines: lines.map((text, index) => ({
      text,
      box: { x, y: y + index * (height + 8), width, height },
      languages: ['en'],
    })),
  };
}

/** A nutrition table where each row is label and value side by side. */
function table(rows: readonly [string, string][], top: number): OcrBlock[] {
  return rows.flatMap(([label, value], index) => [
    block([label], top + index * 32, 0, 170),
    block([value], top + index * 32, 190, 120),
  ]);
}

const INGREDIENTS = block(
  [
    'INGREDIENTS: Whole wheat flour (atta) (52%),',
    'sugar, edible vegetable oil (palm), milk solids,',
    'raising agents (INS 500(ii), 503(ii)), salt.',
  ],
  0,
);

const NUTRITION = [
  ...table(
    [
      ['Nutrition Information', 'Per 100 g'],
      ['Energy', '1950 kJ'],
      ['Fat', '18.5 g'],
      ['Saturated fat', '8.2 g'],
      ['Total Sugars', '24 g'],
      ['Protein', '7.1 g'],
      ['Sodium', '0.32 g'],
    ],
    200,
  ),
];

const COMBINED: OcrPage = { blocks: [INGREDIENTS, ...NUTRITION] };

describe('splitLabelPanels', () => {
  it('finds both panels in one photo', () => {
    const panels = splitLabelPanels(COMBINED);
    expect(panels.ingredientsText).toMatch(/^INGREDIENTS: Whole wheat flour/);
    expect(panels.ingredientsText).toMatch(/salt\.$/);
    expect(panels.nutritionFragments.length).toBeGreaterThan(6);
    expect(
      panels.nutritionFragments.some((fragment) =>
        /Whole wheat/.test(fragment.text),
      ),
    ).toBe(false);
  });

  it('finds only ingredients when there is no table', () => {
    const panels = splitLabelPanels({ blocks: [INGREDIENTS] });
    expect(panels.ingredientsText).not.toBeNull();
    expect(panels.nutritionFragments).toEqual([]);
  });

  it('finds only nutrition when there is no ingredient heading', () => {
    const panels = splitLabelPanels({ blocks: NUTRITION });
    expect(panels.ingredientsText).toBeNull();
    expect(panels.nutritionFragments.length).toBeGreaterThan(0);
  });

  it('finds neither in unrelated text and invents nothing', () => {
    const panels = splitLabelPanels({
      blocks: [block(['Crunchy and delicious!', 'Made with love'], 0)],
    });
    expect(panels).toEqual({ ingredientsText: null, nutritionFragments: [] });
  });

  it('stops the ingredient list at the next section heading', () => {
    const panels = splitLabelPanels({
      blocks: [
        block(['Ingredients: rice, salt.'], 0),
        block(['Store in a cool and dry place.'], 40),
      ],
    });
    expect(panels.ingredientsText).toBe('Ingredients: rice, salt.');
  });
});

describe('label session (D57)', () => {
  const photo = (id: string) => ({ imageId: id, uri: `file:///${id}.jpg` });

  it('fills both panels from one combined photo', () => {
    const start = createLabelSession('s1', null);
    const { session, outcome, orphanedUris } = applyPhoto(
      start,
      photo('p1'),
      splitLabelPanels(COMBINED),
      null,
    );
    expect(outcome).toEqual({
      kind: 'filled',
      panels: ['ingredients', 'nutrition'],
    });
    expect(session.ingredients.imageId).toBe('p1');
    expect(session.nutrition.imageId).toBe('p1');
    expect(session.photos).toHaveLength(1);
    expect(orphanedUris).toEqual([]);
    expect(isReadyForReview(session)).toBe(true);
  });

  it('accepts separate photos in either order', () => {
    let session = createLabelSession('s1', null);
    session = applyPhoto(
      session,
      photo('n'),
      splitLabelPanels({ blocks: NUTRITION }),
      null,
    ).session;
    expect(missingPanels(session)).toEqual(['ingredients']);
    session = applyPhoto(
      session,
      photo('i'),
      splitLabelPanels({ blocks: [INGREDIENTS] }),
      null,
    ).session;
    expect(isReadyForReview(session)).toBe(true);
    expect(session.photos.map((p) => p.imageId).sort()).toEqual(['i', 'n']);
  });

  it('retake replaces only the named panel and keeps the shared photo', () => {
    let session = applyPhoto(
      createLabelSession('s1', null),
      photo('both'),
      splitLabelPanels(COMBINED),
      null,
    ).session;
    const result = applyPhoto(
      session,
      photo('retake'),
      splitLabelPanels(COMBINED),
      'nutrition',
    );
    session = result.session;
    expect(session.ingredients.imageId).toBe('both');
    expect(session.nutrition.imageId).toBe('retake');
    expect(result.orphanedUris).toEqual([]);
  });

  it('deletes a photo once no panel uses it', () => {
    const first = applyPhoto(
      createLabelSession('s1', null),
      photo('n1'),
      splitLabelPanels({ blocks: NUTRITION }),
      null,
    ).session;
    const second = applyPhoto(
      first,
      photo('n2'),
      splitLabelPanels({ blocks: NUTRITION }),
      'nutrition',
    );
    expect(second.orphanedUris).toEqual(['file:///n1.jpg']);
  });

  it('changes nothing for a photo with neither panel', () => {
    const start = createLabelSession('s1', null);
    const result = applyPhoto(
      start,
      photo('blank'),
      { ingredientsText: null, nutritionFragments: [] },
      null,
    );
    expect(result.outcome).toEqual({ kind: 'neither' });
    expect(result.session).toBe(start);
    expect(result.orphanedUris).toEqual(['file:///blank.jpg']);
  });

  it('lets the user mark a panel absent', () => {
    const start = applyPhoto(
      createLabelSession('s1', null),
      photo('i'),
      splitLabelPanels({ blocks: [INGREDIENTS] }),
      null,
    ).session;
    const { session } = markPanelAbsent(start, 'nutrition');
    expect(session.nutrition.state).toBe('user_marked_absent');
    expect(isReadyForReview(session)).toBe(true);
  });
});

describe('buildLabelSnapshot', () => {
  const session = applyPhoto(
    createLabelSession('s1', null),
    { imageId: 'p1', uri: 'file:///p1.jpg' },
    splitLabelPanels(COMBINED),
    null,
  ).session;

  it('builds a contract-valid snapshot from one photo', () => {
    const snapshot = buildLabelSnapshot({
      session,
      corrections: NO_CORRECTIONS,
      capturedAt: '2026-10-16T10:00:00.000Z',
      base: null,
    });
    const validate = localValidators.ProductSnapshot;
    expect(validate?.(snapshot)).toBe(true);
    expect(snapshot.ingredients.map((m) => m.text)).toContain('sugar');
    const sugars = snapshot.observations.find((o) => o.field === 'sugars');
    expect(sugars).toMatchObject({ value: 24, unit: 'g', basis: 'per_100_g' });
    // A field not on the label stays missing, not zero.
    const fibre = snapshot.observations.find((o) => o.field === 'fibre');
    expect(fibre).toMatchObject({ kind: 'missing' });
    expect(snapshot.panels.map((p) => p.imageId)).toEqual(['p1', 'p1']);
    expect(snapshot.sourceRefs.every((ref) => ref.kind === 'label')).toBe(true);
  });

  it('records a correction as corrected and keeps the original source', () => {
    const snapshot = buildLabelSnapshot({
      session,
      corrections: {
        ingredients: {},
        nutrients: {
          sugars: { kind: 'value', value: 21, unit: 'g', basis: 'per_100_g' },
          protein: { kind: 'unreadable' },
        },
      },
      capturedAt: '2026-10-16T10:00:00.000Z',
      base: null,
    });
    const sugars = snapshot.observations.find((o) => o.field === 'sugars');
    expect(sugars?.kind).toBe('corrected');
    if (sugars?.kind === 'corrected') {
      expect(sugars.value).toBe(21);
      const previous = snapshot.sourceRefs.find(
        (ref) => ref.id === sugars.previousSourceIds[0],
      );
      expect(previous?.kind).toBe('label');
      const now = snapshot.sourceRefs.find(
        (ref) => ref.id === sugars.sourceIds[0],
      );
      expect(now?.kind).toBe('user_correction');
    }
    expect(
      snapshot.observations.find((o) => o.field === 'protein'),
    ).toMatchObject({
      kind: 'missing',
      reason: 'unreadable',
    });
  });

  it('corrects an ingredient transcription only', () => {
    const first = buildLabelSnapshot({
      session,
      corrections: NO_CORRECTIONS,
      capturedAt: '2026-10-16T10:00:00.000Z',
      base: null,
    });
    const target = first.ingredients[1];
    expect(target).toBeDefined();
    const fixed = buildLabelSnapshot({
      session,
      corrections: {
        ingredients: {
          [target?.id ?? '']: { kind: 'text', text: 'cane sugar' },
        },
        nutrients: {},
      },
      capturedAt: '2026-10-16T10:00:00.000Z',
      base: null,
    });
    const mention = fixed.ingredients.find((m) => m.id === target?.id);
    expect(mention?.text).toBe('cane sugar');
    expect(mention?.state).toBe('unresolved');
    const firstSource = fixed.sourceRefs.find(
      (ref) => ref.id === mention?.sourceIds[0],
    );
    expect(firstSource?.kind).toBe('user_correction');
  });

  it('completes an Open Food Facts record and keeps its barcode', () => {
    const base = buildLabelSnapshot({
      session: { ...createLabelSession('b', '8901234567890') },
      corrections: NO_CORRECTIONS,
      capturedAt: '2026-10-16T09:00:00.000Z',
      base: null,
    });
    const offBase = {
      ...base,
      id: 'off:8901234567890',
      name: 'Test biscuits',
      sourceRefs: [
        { id: 'src-0', kind: 'off' as const, title: 'Open Food Facts product' },
      ],
    };
    const snapshot = buildLabelSnapshot({
      session,
      corrections: NO_CORRECTIONS,
      capturedAt: '2026-10-16T10:00:00.000Z',
      base: offBase,
    });
    expect(snapshot.barcode).toBe('8901234567890');
    expect(snapshot.name).toBe('Test biscuits');
    expect(new Set(snapshot.sourceRefs.map((ref) => ref.kind))).toEqual(
      new Set(['off', 'label']),
    );
    expect(new Set(snapshot.sourceRefs.map((ref) => ref.id)).size).toBe(
      snapshot.sourceRefs.length,
    );
  });
});
