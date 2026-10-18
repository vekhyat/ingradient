import { ActivityIndicator, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import type { Letter } from '../view-models/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { Card, Divider } from './Card';
import { GradeBadge } from './GradeBadge';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface HistoryRow {
  snapshotId: string;
  name: string;
  capturedAt: string;
  /** "Product alone", plus the assessed method when there is one. */
  label: string;
  letter: Letter | null;
  kind: 'product' | 'personal_snapshot';
}

export interface HistoryListProps {
  rows: readonly HistoryRow[];
  state: 'loading' | 'empty' | 'ready' | 'error';
  onOpen: (snapshotId: string) => void;
  onDelete: (snapshotId: string) => void;
  onRetry: () => void;
}

export function formatSavedDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Component 18. Saved snapshots, newest first. Each row says what kind of
 * assessment it holds and when. Delete is an explicit button with a named
 * confirmation; there is no swipe-to-delete. A read failure is an error,
 * never "empty history".
 */
export function HistoryList({
  rows,
  state,
  onOpen,
  onDelete,
  onRetry,
}: HistoryListProps) {
  const colors = useColors();

  if (state === 'loading') {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', gap: space.s3, alignItems: 'center' }}
      >
        <ActivityIndicator color={colors.primary} />
        <AppText color="ink2" style={{ flexShrink: 1 }}>
          {enGB.history.loading}
        </AppText>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <Card style={{ gap: space.s3 }}>
        <AppText accessibilityRole="alert">{enGB.history.error}</AppText>
        <Button label={enGB.common.retry} variant="tonal" onPress={onRetry} />
      </Card>
    );
  }
  if (state === 'empty' || rows.length === 0) {
    return (
      <Card>
        <AppText color="ink2">{enGB.history.empty}</AppText>
      </Card>
    );
  }

  return (
    <Card padded={false}>
      {rows.map((row, index) => (
        <View key={row.snapshotId}>
          {index > 0 ? <Divider /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={[
                row.name,
                row.letter ? enGB.grade.name(row.letter) : enGB.history.noGrade,
                row.label,
                enGB.history.savedAt(formatSavedDate(row.capturedAt)),
              ].join('. ')}
              radius={radius.md}
              onPress={() => onOpen(row.snapshotId)}
              style={{
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s3,
                padding: space.s4,
              }}
            >
              {row.letter ? (
                <GradeBadge
                  letter={row.letter}
                  role="scientific"
                  size="md"
                  motion="still"
                  speak={false}
                />
              ) : (
                <View
                  style={{
                    width: size.badgeMd,
                    height: size.badgeMd,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: colors.hair2,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Icon name="remove" color={colors.ink2} />
                </View>
              )}
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="subhead">{row.name}</AppText>
                <AppText variant="bodySm" color="ink2">
                  {`${row.label} · ${enGB.history.savedAt(formatSavedDate(row.capturedAt))}`}
                </AppText>
              </View>
            </Touchable>
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={enGB.history.deleteAction(row.name)}
              radius={radius.full}
              onPress={() => onDelete(row.snapshotId)}
              style={{
                width: size.targetMin,
                height: size.targetMin,
                marginRight: space.s2,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Icon name="delete" color={colors.ink2} />
            </Touchable>
          </View>
        </View>
      ))}
    </Card>
  );
}
