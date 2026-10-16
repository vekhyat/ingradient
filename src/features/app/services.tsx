import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import { createCatalogueAdapter } from '../../adapters/catalogue';
import { recogniseLabel } from '../../adapters/native/text-recognition';
import { StorageError } from '../../adapters/storage/records';
import {
  adoptSessionPhoto,
  clearSessionPhotos,
  deleteSessionPhoto,
} from '../../adapters/storage/session-photos';
import {
  createSnapshotStore,
  type SnapshotStore,
} from '../../adapters/storage/snapshot-store';
import {
  destroyEncryptedDatabase,
  openEncryptedDatabase,
  sqlRecordTable,
} from '../../adapters/storage/sqlcipher-table';
import { LabelFlow } from '../capture/label-flow';
import { methodNotInstalledAnalyser } from '../scan/analyser';
import { ScanSession, newOperationId } from '../scan/scan-session';

/** Open Food Facts asks every app to identify itself and give a contact. */
const USER_AGENT = `Ingradient - ${Platform.OS === 'ios' ? 'iOS' : 'Android'} - Version 0.1.0 - https://github.com/vekhyat/ingradient`;

/** ONB-01: the notice version the user must accept before analysis. */
export const NOTICE_VERSION = '1-draft';
const NOTICE_KEY = 'ingradient.notice.accepted';

export type StoreStatus =
  | { status: 'opening' }
  | { status: 'ready'; store: SnapshotStore }
  | { status: 'error'; code: StorageError['code']; message: string };

interface Services {
  scan: ScanSession;
  label: LabelFlow;
  store: StoreStatus;
  reopenStore: () => void;
  resetStore: () => Promise<void>;
  /** Bumped after every save/delete so lists refresh. */
  storeRevision: number;
  bumpStore: () => void;
  noticeAccepted: boolean | null;
  acceptNotice: () => Promise<void>;
}

const ServicesContext = createContext<Services | null>(null);

export function AppServicesProvider({ children }: { children: ReactNode }) {
  const [scan] = useState(
    () =>
      new ScanSession(
        createCatalogueAdapter({ userAgent: USER_AGENT }),
        methodNotInstalledAnalyser,
      ),
  );
  const [label] = useState(
    () =>
      new LabelFlow({
        recognise: recogniseLabel,
        adoptPhoto: adoptSessionPhoto,
        deletePhoto: deleteSessionPhoto,
        newId: () => newOperationId('label'),
      }),
  );

  const [store, setStore] = useState<StoreStatus>({ status: 'opening' });
  const [storeRevision, setStoreRevision] = useState(0);
  const [noticeAccepted, setNoticeAccepted] = useState<boolean | null>(null);

  const loadStore = useCallback(() => {
    openEncryptedDatabase()
      .then((db) =>
        setStore({
          status: 'ready',
          store: createSnapshotStore(sqlRecordTable(db)),
        }),
      )
      .catch((error: unknown) => {
        const code = error instanceof StorageError ? error.code : 'unavailable';
        if (__DEV__) {
          // Storage errors carry no product or personal data.
          console.warn(
            `Saved-results store failed: ${code}: ${(error as Error).message}`,
          );
        }
        setStore({
          status: 'error',
          code,
          message: (error as Error).message,
        });
      });
  }, []);

  const openStore = useCallback(() => {
    setStore({ status: 'opening' });
    loadStore();
  }, [loadStore]);

  useEffect(() => {
    // Session photos never survive an app restart (STO-01 case 3).
    clearSessionPhotos();
    loadStore();
    SecureStore.getItemAsync(NOTICE_KEY)
      .then((value) => setNoticeAccepted(value === NOTICE_VERSION))
      .catch(() => setNoticeAccepted(false));
  }, [loadStore]);

  const value = useMemo<Services>(
    () => ({
      scan,
      label,
      store,
      reopenStore: openStore,
      resetStore: async () => {
        await destroyEncryptedDatabase();
        openStore();
      },
      storeRevision,
      bumpStore: () => setStoreRevision((n) => n + 1),
      noticeAccepted,
      acceptNotice: async () => {
        await SecureStore.setItemAsync(NOTICE_KEY, NOTICE_VERSION);
        const stored = await SecureStore.getItemAsync(NOTICE_KEY);
        if (stored !== NOTICE_VERSION) {
          throw new Error('Notice acceptance was not stored.');
        }
        setNoticeAccepted(true);
      },
    }),
    [scan, label, store, openStore, storeRevision, noticeAccepted],
  );

  return (
    <ServicesContext.Provider value={value}>
      {children}
    </ServicesContext.Provider>
  );
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('useServices must be used inside AppServicesProvider');
  }
  return services;
}

export function useScanState() {
  const { scan } = useServices();
  return useSyncExternalStore(scan.subscribe, scan.getState);
}

export function useLabelState() {
  const { label } = useServices();
  return useSyncExternalStore(label.subscribe, label.getState);
}
