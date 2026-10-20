import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { useEffect as mockUseEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import YouTab from '../../app/(tabs)/you';
import { Button } from '../../components/Button';
import { LocalDataControls } from '../../components/LocalDataControls';
import { Sheet } from '../../components/Sheet';
import { enGB } from '../../copy/en-GB';
import {
  createSnapshotStore,
  MemoryRecordTable,
} from '../../adapters/storage/snapshot-store';
import type { StoreStatus } from './services';

let mockStore: StoreStatus;
const mockResetStore = jest.fn<() => Promise<void>>();
const mockBumpStore = jest.fn();
jest.mock('./services', () => ({
  useServices: () => ({
    store: mockStore,
    storeRevision: 0,
    resetStore: mockResetStore,
    bumpStore: mockBumpStore,
  }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (effect: () => void | (() => void)) =>
    mockUseEffect(effect, [effect]),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
}));
jest.mock('../../theme/ThemeProvider', () => ({
  useColors: () => ({ bg: 'white' }),
}));
jest.mock('../../components/AppText', () => ({ AppText: () => null }));
jest.mock('../../components/Button', () => ({ Button: () => null }));
jest.mock('../../components/Card', () => ({ Divider: () => null }));
jest.mock('../../components/Sheet', () => ({ Sheet: () => null }));

describe('local data erase availability', () => {
  let screen: ReactTestRenderer | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetStore.mockResolvedValue(undefined);
    mockStore = { status: 'opening' };
  });
  afterEach(async () => {
    await act(() => screen?.unmount());
  });
  const controls = () => screen!.root.findByType(LocalDataControls);
  const eraseButton = () =>
    screen!.root
      .findAllByType(Button)
      .find((button) => button.props.label === enGB.you.erase)!;

  it('blocks startup erasure and allows recovery without inventing a saved count', async () => {
    await act(async () => {
      screen = create(<YouTab />);
    });
    expect(controls().props.savedCount).toBeNull();
    expect(eraseButton().props.disabledReason).toBe(enGB.history.loading);
    act(() => {
      controls().props.onErase();
    });
    expect(screen!.root.findByType(Sheet).props.visible).toBe(false);
    mockStore = {
      status: 'error',
      code: 'key_lost',
      message: 'Key unavailable',
    };
    await act(async () => {
      screen!.update(<YouTab />);
    });
    expect(controls().props.savedCount).toBeNull();
    expect(eraseButton().props.disabledReason).toBeUndefined();
    act(() => {
      controls().props.onErase();
    });
    expect(screen!.root.findByType(Sheet).props.visible).toBe(true);
    await act(async () => {
      await screen!.root.findByType(Sheet).props.primaryAction.onPress();
    });
    expect(mockResetStore).toHaveBeenCalledTimes(1);
    expect(mockBumpStore).toHaveBeenCalledTimes(1);
    expect(controls().props.operation).toBe('erased');
  });

  it('ignores a stale empty count after the database fails to open', async () => {
    let finish: (count: number) => void = () => undefined;
    const saved = createSnapshotStore(new MemoryRecordTable());
    mockStore = {
      status: 'ready',
      store: {
        ...saved,
        count: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      },
    };
    await act(async () => {
      screen = create(<YouTab />);
    });
    mockStore = {
      status: 'error',
      code: 'unavailable',
      message: 'Cannot reopen',
    };
    await act(async () => {
      screen!.update(<YouTab />);
    });
    await act(async () => {
      finish(0);
    });
    expect(controls().props.savedCount).toBeNull();
    expect(eraseButton().props.disabledReason).toBeUndefined();
  });

  it('shows a known empty store and reports failed recovery without claiming erasure', async () => {
    mockStore = {
      status: 'ready',
      store: createSnapshotStore(new MemoryRecordTable()),
    };
    await act(async () => {
      screen = create(<YouTab />);
    });
    expect(controls().props.savedCount).toBe(0);
    expect(eraseButton().props.disabledReason).toBe(enGB.history.empty);
    mockStore = {
      status: 'error',
      code: 'key_lost',
      message: 'Key unavailable',
    };
    mockResetStore.mockRejectedValueOnce(new Error('WAL locked'));
    await act(async () => {
      screen!.update(<YouTab />);
    });
    act(() => {
      controls().props.onErase();
    });
    await act(async () => {
      await screen!.root.findByType(Sheet).props.primaryAction.onPress();
    });
    expect(controls().props.operation).toBe('failed');
    expect(controls().props.savedCount).toBeNull();
    expect(mockBumpStore).not.toHaveBeenCalled();
    expect(eraseButton().props.disabledReason).toBeUndefined();
  });
});
