import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import vectors from '../../../resources/vectors/nutriscore-vectors.json';
import { MemoryRecordTable } from '../../adapters/storage/snapshot-store';
import type { ProductSnapshot } from '../../domain/contracts/generated/local';
import { localValidators } from '../../domain/contracts/generated/validate-local';
import { wireValidators } from '../../domain/contracts/generated/validate-wire';
import type { AnalyzeResponse } from '../../domain/contracts/generated/wire';
import { installedResources } from '../../domain/hybrid/resources';
import { replayScientificSnapshot } from '../../domain/pipeline/replay-scientific-snapshot';
import { buildMockAnalyzeResponse } from '../../mocks/backend/responses';

const mockReadNotice = jest.fn<(key: string) => Promise<string | null>>();
const mockWriteNotice =
  jest.fn<(key: string, value: string) => Promise<void>>();
const mockOpenDatabase = jest.fn<() => Promise<unknown>>();
const mockClearPhotos = jest.fn();
let mockTable: MemoryRecordTable;

jest.mock('expo-secure-store', () => ({
  getItemAsync: (key: string) => mockReadNotice(key),
  setItemAsync: (key: string, value: string) => mockWriteNotice(key, value),
}));
jest.mock('../../adapters/storage/sqlcipher-table', () => ({
  openEncryptedDatabase: () => mockOpenDatabase(),
  sqlRecordTable: () => mockTable,
  destroyEncryptedDatabase: async () => undefined,
}));
jest.mock('../../adapters/storage/session-photos', () => ({
  clearSessionPhotos: () => mockClearPhotos(),
  adoptSessionPhoto: async (uri: string) => uri,
  deleteSessionPhoto: () => undefined,
}));
jest.mock('../../adapters/native/text-recognition', () => ({
  recogniseLabel: jest.fn(),
}));

// Configure only this module load. The real factory and HYB client run below.
const previousUrl = process.env.EXPO_PUBLIC_ANALYSIS_URL;
process.env.EXPO_PUBLIC_ANALYSIS_URL = 'https://analysis.example.invalid';
const { AppServicesProvider, useServices, NOTICE_VERSION } =
  jest.requireActual<typeof import('./services')>('./services');
if (previousUrl === undefined) delete process.env.EXPO_PUBLIC_ANALYSIS_URL;
else process.env.EXPO_PUBLIC_ANALYSIS_URL = previousUrl;

function snapshot(): ProductSnapshot {
  const vector = vectors.vectors[0];
  if (!vector) throw new Error('Canonical input is missing');
  const candidate: unknown = {
    id: 'provider-product',
    barcode: '8901030000001',
    name: 'Canonical food',
    market: 'EU',
    capturedAt: '2026-10-18T12:00:00Z',
    sourceRefs: [
      { id: 'label-source', kind: 'label', title: 'Nutrition panel' },
    ],
    category: 'general',
    scoringFacts: {
      categorySourceIds: ['label-source'],
      cheese: { state: 'absent', sourceIds: ['label-source'] },
      redMeat: { state: 'absent', sourceIds: ['label-source'] },
      plainWater: { state: 'absent', sourceIds: ['label-source'] },
      nonNutritiveSweetener: { state: 'absent', sourceIds: ['label-source'] },
    },
    observations: vector.inputs.observations.map((observation) => ({
      ...observation,
      kind: 'read',
      sourceIds: ['label-source'],
      issues: [],
    })),
    ingredients: [],
    panels: [],
    taxonomyVersion: installedResources().taxonomyVersion,
    evidenceVersion: installedResources().evidenceVersion,
  };
  if (!localValidators.ProductSnapshot(candidate))
    throw new Error('Invalid provider input');
  return candidate as ProductSnapshot;
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('actual app services notice and foreground lifecycle', () => {
  let screen: ReactTestRenderer | undefined;
  let current: ReturnType<typeof useServices> | undefined;
  let onAppState: ((state: AppStateStatus) => void) | undefined;
  let delayMs: number;
  let input: ProductSnapshot;
  const requests: RequestInit[] = [];
  const removeListener = jest.fn();

  function Probe() {
    current = useServices();
    return null;
  }
  function services() {
    if (!current) throw new Error('Provider is not mounted');
    return current;
  }
  async function mount() {
    await act(async () => {
      screen = create(
        <AppServicesProvider>
          <Probe />
        </AppServicesProvider>,
      );
    });
  }
  async function analyse() {
    return services().scan.analyseSnapshot(input, new AbortController().signal);
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    screen = undefined;
    current = undefined;
    onAppState = undefined;
    delayMs = 100;
    input = snapshot();
    requests.length = 0;
    mockTable = new MemoryRecordTable();
    mockReadNotice.mockReset().mockResolvedValue(null);
    mockWriteNotice.mockReset().mockResolvedValue(undefined);
    mockOpenDatabase.mockReset().mockResolvedValue({});
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        onAppState = listener as (state: AppStateStatus) => void;
        return { remove: removeListener };
      });
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      if (!init || init.method !== 'POST') return { status: 200 } as Response;
      requests.push(init);
      const base = buildMockAnalyzeResponse(String(init.body));
      const replay = replayScientificSnapshot(input);
      const candidate: unknown = {
        ...base,
        scientific: { ...replay.scientific, inputSnapshotId: base.product.id },
        citations: [...replay.citations],
      };
      if (!wireValidators.AnalyzeResponse(candidate))
        throw new Error('Invalid wire test answer');
      const answer = candidate as AnalyzeResponse;
      return new Promise<Response>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => {
          init.signal?.removeEventListener('abort', abort);
          resolve({
            status: 200,
            text: async () => JSON.stringify(answer),
          } as Response);
        }, delayMs);
        init.signal?.addEventListener('abort', abort, { once: true });
      });
    });
  });

  afterEach(async () => {
    await act(async () => {
      screen?.unmount();
    });
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('keeps backend submissions blocked while the stored notice is pending or cannot be read', async () => {
    const pending = deferred<string | null>();
    mockReadNotice.mockReturnValueOnce(pending.promise);
    await mount();
    expect(services().noticeAccepted).toBeNull();
    const pendingKey = await analyse();
    expect(requests).toHaveLength(0);
    expect(
      pendingKey && services().scan.getResult(pendingKey)?.fallbackIssue?.code,
    ).toBe('backend_notice_pending');
    await act(async () => {
      pending.reject(new Error('Secure store unavailable'));
    });
    expect(services().noticeAccepted).toBe(false);
    await analyse();
    expect(requests).toHaveLength(0);
  });

  it('enables later submissions only after acceptance is written and read back', async () => {
    await mount();
    const write = deferred<void>();
    const readBack = deferred<string | null>();
    mockWriteNotice.mockReturnValueOnce(write.promise);
    mockReadNotice.mockReturnValueOnce(readBack.promise);
    let accepting: Promise<void> = Promise.resolve();
    await act(async () => {
      accepting = services().acceptNotice();
    });
    await analyse();
    expect(requests).toHaveLength(0);
    await act(async () => {
      write.resolve(undefined);
    });
    await analyse();
    expect(requests).toHaveLength(0);
    expect(services().noticeAccepted).toBe(false);
    await act(async () => {
      readBack.resolve(NOTICE_VERSION);
      await accepting;
    });
    expect(mockWriteNotice).toHaveBeenCalledWith(
      'ingradient.notice.accepted',
      NOTICE_VERSION,
    );
    expect(mockReadNotice).toHaveBeenLastCalledWith(
      'ingradient.notice.accepted',
    );
    expect(services().noticeAccepted).toBe(true);
    const running = analyse();
    await jest.advanceTimersByTimeAsync(100);
    const key = await running;
    expect(requests).toHaveLength(1);
    expect(key && services().scan.getResult(key)?.executor).toBe('backend');
    expect(mockClearPhotos).toHaveBeenCalledTimes(1);
    expect(services().store.status).toBe('ready');
  });

  it.each(['write', 'readback', 'mismatch'] as const)(
    'keeps the backend blocked after acceptance %s failure',
    async (failure) => {
      await mount();
      if (failure === 'write')
        mockWriteNotice.mockRejectedValueOnce(new Error('Write failed'));
      else if (failure === 'readback')
        mockReadNotice.mockRejectedValueOnce(new Error('Read failed'));
      else mockReadNotice.mockResolvedValueOnce('older-notice');
      await act(async () => {
        await expect(services().acceptNotice()).rejects.toThrow();
      });
      expect(services().noticeAccepted).toBe(false);
      await analyse();
      expect(requests).toHaveLength(0);
    },
  );

  it('backgrounding aborts the pending hybrid request and clears existing and future update offers', async () => {
    mockReadNotice.mockResolvedValueOnce(NOTICE_VERSION);
    await mount();
    delayMs = 3500;
    const first = analyse();
    await jest.advanceTimersByTimeAsync(2000);
    const firstKey = await first;
    if (!firstKey) throw new Error('Missing phone result');
    await jest.advanceTimersByTimeAsync(1500);
    expect(services().scan.getResult(firstKey)?.pendingUpdate).not.toBeNull();
    const second = analyse();
    await jest.advanceTimersByTimeAsync(2000);
    const secondKey = await second;
    if (!secondKey) throw new Error('Missing second phone result');
    expect(requests[1]?.signal?.aborted).toBe(false);
    await act(async () => {
      onAppState?.('background');
    });
    expect(requests[1]?.signal?.aborted).toBe(true);
    expect(services().scan.getResult(firstKey)?.pendingUpdate).toBeNull();
    await jest.advanceTimersByTimeAsync(1500);
    expect(services().scan.getResult(secondKey)?.pendingUpdate).toBeNull();
    expect(services().scan.getResult(firstKey)?.executor).toBe('phone');
    expect(services().scan.getResult(secondKey)?.executor).toBe('phone');
  });

  it('keeps warmUpBackend stable across unrelated provider updates', async () => {
    await mount();
    const first = services().warmUpBackend;
    await act(async () => {
      services().bumpStore();
    });
    mockReadNotice.mockResolvedValueOnce(NOTICE_VERSION);
    await act(async () => {
      await services().acceptNotice();
    });
    expect(services().storeRevision).toBe(1);
    expect(services().noticeAccepted).toBe(true);
    // Capture's focus effect depends on it; a new identity would re-run the
    // effect's cleanup and cancel the analysis in progress.
    expect(services().warmUpBackend).toBe(first);
  });

  it('removes its AppState listener and cancels owned requests when unmounted', async () => {
    mockReadNotice.mockResolvedValueOnce(NOTICE_VERSION);
    await mount();
    delayMs = 3500;
    const running = analyse();
    await jest.advanceTimersByTimeAsync(2000);
    const firstKey = await running;
    if (!firstKey) throw new Error('Missing phone result');
    await jest.advanceTimersByTimeAsync(1500);
    expect(services().scan.getResult(firstKey)?.pendingUpdate).not.toBeNull();
    const next = analyse();
    await jest.advanceTimersByTimeAsync(2000);
    await next;
    expect(requests[1]?.signal?.aborted).toBe(false);
    await act(async () => {
      screen?.unmount();
      screen = undefined;
    });
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(requests[1]?.signal?.aborted).toBe(true);
    expect(services().scan.getResult(firstKey)?.pendingUpdate).toBeNull();
  });
});
