import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '../../components/AppText';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { HistoryList, type HistoryRow } from '../../components/HistoryList';
import { Sheet } from '../../components/Sheet';
import { enGB } from '../../copy/en-GB';
import { useServices } from '../../features/app/services';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

/**
 * U13 History. Saved results from the encrypted store. A read failure is
 * shown as an error, never as an empty list; deleting asks first and
 * reports success only after the store confirms it.
 */
export default function HistoryTab() {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { store, scan, storeRevision, bumpStore, reopenStore } = useServices();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [state, setState] = useState<'loading' | 'empty' | 'ready' | 'error'>(
    'loading',
  );
  const [deleting, setDeleting] = useState<HistoryRow | null>(null);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  const load = useCallback(() => {
    if (store.status === 'opening') {
      setState('loading');
      return;
    }
    if (store.status === 'error') {
      setState('error');
      return;
    }
    setState('loading');
    store.store
      .list()
      .then((summaries) => {
        setRows(
          summaries.map((summary) => ({
            snapshotId: summary.id,
            name: summary.name ?? enGB.identity.nameMissing,
            capturedAt: summary.savedAt,
            label: enGB.history.productKind,
            letter: summary.letter,
            kind: 'product',
          })),
        );
        setState(summaries.length === 0 ? 'empty' : 'ready');
      })
      .catch(() => setState('error'));
  }, [store]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load, storeRevision]), // eslint-disable-line react-hooks/exhaustive-deps
  );

  const open = async (id: string) => {
    if (store.status !== 'ready') {
      return;
    }
    setOpenFailed(false);
    try {
      const record = await store.store.get(id);
      const key = scan.addResult(
        record.snapshot,
        record.assessment,
        record.executor,
        'history',
        record.id,
        record.savedAt,
      );
      router.push({ pathname: '/result/[key]', params: { key } });
    } catch {
      setOpenFailed(true);
    }
  };

  const confirmDelete = async () => {
    if (!deleting || store.status !== 'ready') {
      return;
    }
    try {
      await store.store.remove(deleting.snapshotId);
      scan.forgetSaved(deleting.snapshotId);
      setDeleting(null);
      setDeleteFailed(false);
      bumpStore();
    } catch {
      setDeleteFailed(true);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: space.s4,
        paddingTop: insets.top + space.s4,
        gap: space.s4,
      }}
    >
      <AppText variant="display" heading>
        {enGB.history.title}
      </AppText>
      {openFailed ? (
        <Card>
          <AppText accessibilityRole="alert">{enGB.history.error}</AppText>
        </Card>
      ) : null}
      <HistoryList
        rows={rows}
        state={state}
        onOpen={(id) => void open(id)}
        onDelete={(id) => {
          setDeleteFailed(false);
          setDeleting(rows.find((row) => row.snapshotId === id) ?? null);
        }}
        onRetry={() => (store.status === 'error' ? reopenStore() : load())}
      />
      {store.status === 'error' && store.code === 'key_lost' ? (
        <Button
          label={enGB.you.erase}
          variant="outline"
          onPress={() => router.push('/you')}
        />
      ) : null}

      <Sheet
        visible={deleting !== null}
        title={enGB.history.deleteTitle(deleting?.name ?? '')}
        dirty={false}
        onClose={() => setDeleting(null)}
        secondaryAction={{
          label: enGB.common.cancel,
          variant: 'tonal',
          onPress: () => setDeleting(null),
        }}
        primaryAction={{
          label: enGB.history.deleteConfirm,
          variant: 'outline',
          onPress: () => void confirmDelete(),
        }}
      >
        <AppText>{enGB.history.deleteBody}</AppText>
        {deleteFailed ? (
          <AppText color="alertInk" accessibilityRole="alert">
            {enGB.history.deleteFailed}
          </AppText>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
