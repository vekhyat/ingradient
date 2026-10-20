import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';

import { createCatalogueAdapter } from '../../adapters/catalogue';
import { buildOffUserAgent } from '../../adapters/catalogue/user-agent';
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
  closeEncryptedDatabase,
  destroyEncryptedDatabase,
  openEncryptedDatabase,
  sqlRecordTable,
} from '../../adapters/storage/sqlcipher-table';
import { LabelFlow } from '../capture/label-flow';
import { ScanSession, newOperationId } from '../scan/scan-session';
import { createAnalysis } from './analysis';

/** Open Food Facts asks every app to identify itself and give a contact. */
const USER_AGENT = buildOffUserAgent(
  Platform.OS,
  Constants.expoConfig?.version ?? '',
);

/** ONB-01: the notice version the user must accept before analysis. */
export const NOTICE_VERSION = '1-draft';
const NOTICE_KEY = 'ingradient.notice.accepted';

/**
 * The optional analysis server URL. Unset means phone-only even when a
 * deployed backend is available (D174). For a local FastAPI run on the
 * Android emulator, EXPO_PUBLIC_ANALYSIS_URL=http://10.0.2.2:8000.
 */
const ANALYSIS_URL = process.env.EXPO_PUBLIC_ANALYSIS_URL ?? '';

/** The accepted notice version, read by analysers at call time. */
class AcceptedNotice {
  private version: string | null = null;
  get = (): string | null => this.version;
  set(version: string | null): void {
    this.version = version;
  }
}

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
  /** HYB-01: wake the backend on Scan entry (rate-limited by the client). */
  warmUpBackend: () => void;
}

const ServicesContext = createContext<Services | null>(null);

export function AppServicesProvider({ children }: { children: ReactNode }) {
  // Read at analysis time, so acceptance applies without rebuilding services.
  const [acceptedNotice] = useState(() => new AcceptedNotice());
  const [analysis] = useState(() =>
    createAnalysis(
      { acceptedNoticeVersion: acceptedNotice.get },
      { baseUrl: ANALYSIS_URL, fetch: (input, init) => fetch(input, init) },
    ),
  );
  const [scan] = useState(
    () =>
      new ScanSession(
        createCatalogueAdapter({ userAgent: USER_AGENT }),
        analysis.analyser,
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

  const storeState = useRef<StoreStatus>(store);
  const database = useRef<SQLiteDatabase | null>(null);
  const storeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const storeGeneration = useRef(0);
  const mounted = useRef(false);

  const forgetSavedLinks = useCallback(() => {
    scan.forgetAllSaved();
  }, [scan]);

  const loadStore = useCallback(
    (reset = false): Promise<void> => {
      // Recovery is available only after opening has failed. In particular a
      // press during startup must never erase a healthy database or its key.
      if (reset && storeState.current.status !== 'error') {
        return Promise.reject(
          new StorageError(
            'unavailable',
            'Saved results are not ready for recovery.',
          ),
        );
      }
      const generation = ++storeGeneration.current;
      storeState.current = { status: 'opening' };
      setStore(storeState.current);
      const opening = storeQueue.current.then(async () => {
        try {
          if (database.current) {
            await closeEncryptedDatabase(database.current);
            database.current = null;
          }
          if (reset) {
            await destroyEncryptedDatabase();
            forgetSavedLinks();
          }
          const db = await openEncryptedDatabase();
          if (!mounted.current || generation !== storeGeneration.current) {
            await closeEncryptedDatabase(db);
            return;
          }
          database.current = db;
          const saved = createSnapshotStore(sqlRecordTable(db));
          storeState.current = {
            status: 'ready',
            store: {
              ...saved,
              eraseAll: async () => {
                await saved.eraseAll();
                forgetSavedLinks();
              },
            },
          };
          setStore(storeState.current);
        } catch (error) {
          const code =
            error instanceof StorageError ? error.code : 'unavailable';
          const message =
            error instanceof Error
              ? error.message
              : 'Could not open saved results.';
          if (mounted.current && generation === storeGeneration.current) {
            storeState.current = { status: 'error', code, message };
            setStore(storeState.current);
          }
          throw error;
        }
      });
      storeQueue.current = opening.catch(() => undefined);
      return opening;
    },
    [forgetSavedLinks],
  );

  // Stable, so Capture's focus effect (which cancels analysis on cleanup)
  // does not re-run when an unrelated service value changes.
  const warmUpBackend = useCallback(
    () => analysis.hybrid?.warmUp(),
    [analysis],
  );

  const openStore = useCallback(() => {
    void loadStore().catch(() => undefined);
  }, [loadStore]);

  useEffect(() => {
    // Session photos never survive an app restart (STO-01 case 3).
    mounted.current = true;
    clearSessionPhotos();
    void loadStore().catch(() => undefined);
    SecureStore.getItemAsync(NOTICE_KEY)
      .then((value) => {
        const accepted = value === NOTICE_VERSION;
        acceptedNotice.set(accepted ? NOTICE_VERSION : null);
        setNoticeAccepted(accepted);
      })
      .catch(() => setNoticeAccepted(false));
    return () => {
      mounted.current = false;
      storeGeneration.current += 1;
      storeQueue.current = storeQueue.current
        .then(async () => {
          if (database.current) {
            await closeEncryptedDatabase(database.current);
            database.current = null;
          }
        })
        .catch(() => undefined);
    };
  }, [loadStore, acceptedNotice]);

  useEffect(() => {
    // D70 / HYB-01 case 5: no update offer survives leaving the app.
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') {
        analysis.hybrid?.cancelAll();
        scan.dropPendingUpdates();
      }
    });
    return () => {
      subscription.remove();
      analysis.hybrid?.cancelAll();
      scan.dropPendingUpdates();
    };
  }, [scan, analysis]);

  const value = useMemo<Services>(
    () => ({
      scan,
      label,
      store,
      reopenStore: openStore,
      resetStore: () => loadStore(true),
      storeRevision,
      bumpStore: () => setStoreRevision((n) => n + 1),
      noticeAccepted,
      acceptNotice: async () => {
        await SecureStore.setItemAsync(NOTICE_KEY, NOTICE_VERSION);
        const stored = await SecureStore.getItemAsync(NOTICE_KEY);
        if (stored !== NOTICE_VERSION) {
          throw new Error('Notice acceptance was not stored.');
        }
        acceptedNotice.set(NOTICE_VERSION);
        setNoticeAccepted(true);
      },
      warmUpBackend,
    }),
    [
      scan,
      label,
      store,
      openStore,
      loadStore,
      storeRevision,
      noticeAccepted,
      acceptedNotice,
      warmUpBackend,
    ],
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
