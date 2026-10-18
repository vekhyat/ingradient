import { describe, expect, it, jest } from '@jest/globals';
import { localValidators } from '../../domain/contracts/generated/validate-local';
import { LabelFlow, type LabelFlowDeps } from './label-flow';
import type { OcrBlock, OcrOutcome, OcrPage } from './ocr-page';

function block(text: string, y: number, x = 0): OcrBlock {
  const box = { x, y, width: 160, height: 22 };
  return { text, box, lines: [{ text, box, languages: ['en'] }] };
}

const INGREDIENTS: OcrPage = {
  blocks: [block('Ingredients: rice, sugar, salt.', 0)],
};
const NUTRITION: OcrPage = {
  blocks: [
    block('Nutrition Information', 100),
    block('Per 100 g', 100, 190),
    block('Energy', 132),
    block('800 kJ', 132, 190),
    block('Total Sugars', 164),
    block('12 g', 164, 190),
    block('Protein', 196),
    block('6 g', 196, 190),
  ],
};
const COMBINED: OcrPage = {
  blocks: [...INGREDIENTS.blocks, ...NUTRITION.blocks],
};
const read = (page: OcrPage): OcrOutcome => ({ status: 'read', page });
const OCR_FAILURES: [string, OcrOutcome][] = [
  ['no_text', { status: 'no_text' }],
  [
    'unsupported_language',
    { status: 'unsupported_language', script: 'Devanagari' },
  ],
  ['engine_error', { status: 'engine_error', message: 'Native diagnostic' }],
];

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Deferred promise not initialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('Deferred promise not initialized');
  };
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness() {
  let nextId = 0;
  const recognise = jest.fn<LabelFlowDeps['recognise']>(async () =>
    read(COMBINED),
  );
  const adoptPhoto = jest.fn<LabelFlowDeps['adoptPhoto']>(
    async (uri) => `owned:${uri}`,
  );
  const deletePhoto = jest.fn<LabelFlowDeps['deletePhoto']>();
  const flow = new LabelFlow({
    recognise,
    adoptPhoto,
    deletePhoto,
    newId: () => `capture-${++nextId}`,
  });
  flow.start(null);
  return { flow, recognise, adoptPhoto, deletePhoto };
}

describe('LabelFlow asynchronous capture', () => {
  it('builds both parsed panels from one image with shared provenance', async () => {
    const { flow, recognise, deletePhoto } = harness();
    const pending = flow.addPhoto('combined');
    expect(flow.getState().reading).toBe(true);
    expect(await pending).toEqual({
      kind: 'filled',
      panels: ['ingredients', 'nutrition'],
    });
    expect(recognise).toHaveBeenCalledWith('owned:combined');
    const state = flow.getState();
    expect(state.reading).toBe(false);
    expect(state.session?.photos).toHaveLength(1);
    expect(state.session?.ingredients.imageId).toBe(
      state.session?.nutrition.imageId,
    );
    const snapshot = flow.buildSnapshot('2026-10-18T12:00:00Z');
    expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
    expect(snapshot?.ingredients.map((ingredient) => ingredient.text)).toEqual([
      'rice',
      'sugar',
      'salt',
    ]);
    expect(snapshot?.observations).toContainEqual(
      expect.objectContaining({ field: 'sugars', kind: 'read', value: 12 }),
    );
    expect(deletePhoto).not.toHaveBeenCalled();
  });

  it.each(['ingredients first', 'nutrition first'])(
    'accepts separate panels: %s',
    async (order) => {
      const { flow, recognise } = harness();
      const pages =
        order === 'ingredients first'
          ? [INGREDIENTS, NUTRITION]
          : [NUTRITION, INGREDIENTS];
      for (const [index, page] of pages.entries()) {
        recognise.mockResolvedValueOnce(read(page));
        await expect(flow.addPhoto(`panel-${index}`)).resolves.toMatchObject({
          kind: 'filled',
        });
      }
      expect(flow.getState().session).toMatchObject({
        ingredients: { state: 'read' },
        nutrition: { state: 'read' },
      });
      expect(flow.getState().session?.photos).toHaveLength(2);
      const snapshot = flow.buildSnapshot('2026-10-18T12:00:00Z');
      expect(localValidators.ProductSnapshot(snapshot)).toBe(true);
      expect(snapshot?.panels[0]?.imageId).not.toBe(
        snapshot?.panels[1]?.imageId,
      );
    },
  );

  it('retakes only nutrition and keeps the image still used by ingredients', async () => {
    const { flow, deletePhoto } = harness();
    await flow.addPhoto('combined');
    const oldIngredients = flow.getState().session?.ingredients;
    flow.setRetake('nutrition');
    await expect(flow.addPhoto('retake')).resolves.toEqual({
      kind: 'filled',
      panels: ['nutrition'],
    });
    expect(flow.getState().session?.ingredients).toBe(oldIngredients);
    expect(flow.getState().session?.nutrition.imageId).not.toBe(
      oldIngredients?.imageId,
    );
    expect(flow.getState().session?.photos).toHaveLength(2);
    expect(flow.getState().retake).toBeNull();
    expect(deletePhoto).not.toHaveBeenCalled();
    flow.markAbsent('ingredients');
    expect(deletePhoto).toHaveBeenCalledTimes(1);
    expect(deletePhoto).toHaveBeenCalledWith('owned:combined');
    flow.discard();
    expect(deletePhoto.mock.calls).toEqual([
      ['owned:combined'],
      ['owned:retake'],
    ]);
  });

  it('deletes a replaced separate photo after its last panel is retaken', async () => {
    const { flow, recognise, deletePhoto } = harness();
    recognise.mockResolvedValueOnce(read(NUTRITION));
    await flow.addPhoto('old-table');
    flow.setRetake('nutrition');
    await flow.addPhoto('new-table');
    expect(flow.getState().session?.photos).toHaveLength(1);
    expect(deletePhoto.mock.calls).toEqual([['owned:old-table']]);
  });

  it.each(OCR_FAILURES)(
    'reports %s and removes its photo without invented facts',
    async (kind, outcome) => {
      const { flow, recognise, deletePhoto } = harness();
      const session = flow.getState().session;
      recognise.mockResolvedValueOnce(outcome);
      await expect(flow.addPhoto('unreadable')).resolves.toEqual({ kind });
      expect(flow.getState()).toMatchObject({
        reading: false,
        lastOutcome: { kind },
        session,
      });
      expect(flow.getState().session?.photos).toEqual([]);
      const snapshot = flow.buildSnapshot('2026-10-18T12:00:00Z');
      expect(snapshot?.ingredients).toEqual([]);
      expect(snapshot?.observations.every((o) => o.kind === 'missing')).toBe(
        true,
      );
      expect(snapshot?.category).toBe('unknown');
      expect(deletePhoto.mock.calls).toEqual([['owned:unreadable']]);
    },
  );

  it('removes unrelated text and an already supplied panel without changing facts', async () => {
    const { flow, recognise, deletePhoto } = harness();
    recognise.mockResolvedValueOnce(
      read({ blocks: [block('Made with care', 0)] }),
    );
    await expect(flow.addPhoto('unrelated')).resolves.toEqual({
      kind: 'neither',
    });
    await flow.addPhoto('combined');
    const session = flow.getState().session;
    await expect(flow.addPhoto('duplicate')).resolves.toEqual({
      kind: 'already_present',
      panels: ['ingredients', 'nutrition'],
    });
    expect(flow.getState().session).toBe(session);
    expect(deletePhoto.mock.calls).toEqual([
      ['owned:unrelated'],
      ['owned:duplicate'],
    ]);
  });

  it('reports adoption failure and deletes the raw photo', async () => {
    const { flow, adoptPhoto, recognise, deletePhoto } = harness();
    adoptPhoto.mockRejectedValueOnce(new Error('Storage unavailable'));
    await expect(flow.addPhoto('raw')).resolves.toEqual({
      kind: 'capture_failed',
    });
    expect(flow.getState()).toMatchObject({
      reading: false,
      lastOutcome: { kind: 'capture_failed' },
    });
    expect(recognise).not.toHaveBeenCalled();
    expect(deletePhoto.mock.calls).toEqual([['raw']]);
  });

  it.each(['rejection', 'synchronous throw'])(
    'contains OCR %s, clears reading and deletes the adopted photo',
    async (failure) => {
      const { flow, recognise, deletePhoto } = harness();
      if (failure === 'rejection') {
        recognise.mockRejectedValueOnce(new Error('OCR rejected'));
      } else {
        recognise.mockImplementationOnce(() => {
          throw new Error('OCR threw');
        });
      }
      await expect(flow.addPhoto('failed')).resolves.toEqual({
        kind: 'engine_error',
      });
      expect(flow.getState()).toMatchObject({
        reading: false,
        lastOutcome: { kind: 'engine_error' },
      });
      expect(flow.getState().session?.photos).toEqual([]);
      expect(deletePhoto.mock.calls).toEqual([['owned:failed']]);
    },
  );

  it.each(['discard', 'new session'])(
    'skips OCR after %s during photo adoption',
    async (cancel) => {
      const { flow, adoptPhoto, recognise, deletePhoto } = harness();
      const adopted = deferred<string>();
      adoptPhoto.mockReturnValueOnce(adopted.promise);
      const pending = flow.addPhoto('raw');
      if (cancel === 'discard') flow.discard();
      else flow.start(null);
      const current = flow.getState();
      adopted.resolve('owned:late');
      await expect(pending).resolves.toEqual({ kind: 'capture_failed' });
      expect(flow.getState()).toBe(current);
      expect(recognise).not.toHaveBeenCalled();
      expect(deletePhoto.mock.calls).toEqual([['owned:late']]);
    },
  );

  it('skips superseded adoption without clearing the newer reading state', async () => {
    const { flow, adoptPhoto, recognise, deletePhoto } = harness();
    const oldPhoto = deferred<string>();
    const newRead = deferred<OcrOutcome>();
    adoptPhoto.mockReturnValueOnce(oldPhoto.promise);
    const oldPending = flow.addPhoto('old');
    recognise.mockReturnValueOnce(newRead.promise);
    const newPending = flow.addPhoto('new');
    await Promise.resolve();
    oldPhoto.resolve('owned:old');
    await expect(oldPending).resolves.toEqual({ kind: 'capture_failed' });
    expect(flow.getState()).toMatchObject({ reading: true, lastOutcome: null });
    expect(recognise.mock.calls).toEqual([['owned:new']]);
    expect(deletePhoto.mock.calls).toEqual([['owned:old']]);
    newRead.resolve(read(COMBINED));
    await expect(newPending).resolves.toMatchObject({ kind: 'filled' });
  });

  it.each(['discard', 'new session'])(
    'ignores a late OCR result after %s and deletes the photo',
    async (cancel) => {
      const { flow, recognise, deletePhoto } = harness();
      const ocr = deferred<OcrOutcome>();
      recognise.mockReturnValueOnce(ocr.promise);
      const pending = flow.addPhoto('late');
      await Promise.resolve();
      if (cancel === 'discard') flow.discard();
      else flow.start(null);
      const current = flow.getState();
      ocr.resolve(read(COMBINED));
      await expect(pending).resolves.toEqual({ kind: 'capture_failed' });
      expect(flow.getState()).toBe(current);
      expect(deletePhoto.mock.calls).toEqual([['owned:late']]);
    },
  );

  it('keeps newer panels when an earlier OCR finishes later', async () => {
    const { flow, recognise, deletePhoto } = harness();
    const oldRead = deferred<OcrOutcome>();
    recognise.mockReturnValueOnce(oldRead.promise);
    const oldPending = flow.addPhoto('old');
    await Promise.resolve();
    await flow.addPhoto('new');
    const current = flow.getState();
    oldRead.resolve(read(INGREDIENTS));
    await expect(oldPending).resolves.toEqual({ kind: 'capture_failed' });
    expect(flow.getState()).toBe(current);
    expect(flow.getState().session?.photos.map((p) => p.uri)).toEqual([
      'owned:new',
    ]);
    expect(deletePhoto.mock.calls).toEqual([['owned:old']]);
  });

  it('does not let an old OCR rejection overwrite a newer result', async () => {
    const { flow, recognise, deletePhoto } = harness();
    const oldRead = deferred<OcrOutcome>();
    recognise.mockReturnValueOnce(oldRead.promise);
    const oldPending = flow.addPhoto('old');
    await Promise.resolve();
    await flow.addPhoto('new');
    const current = flow.getState();
    oldRead.reject(new Error('Old engine failed'));
    await expect(oldPending).resolves.toEqual({ kind: 'engine_error' });
    expect(flow.getState()).toBe(current);
    expect(deletePhoto.mock.calls).toEqual([['owned:old']]);
  });

  it('removes a raw photo without a session and reads nothing', async () => {
    const { flow, recognise, adoptPhoto, deletePhoto } = harness();
    flow.discard();
    await expect(flow.addPhoto('unowned')).resolves.toEqual({
      kind: 'capture_failed',
    });
    expect(adoptPhoto).not.toHaveBeenCalled();
    expect(recognise).not.toHaveBeenCalled();
    expect(deletePhoto.mock.calls).toEqual([['unowned']]);
  });
});
