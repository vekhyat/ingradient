import { ActivityIndicator, View } from 'react-native';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import type { IngredientOccurrence } from '../view-models/types';
import { AppText } from './AppText';
import { Button } from './Button';
import { Divider } from './Card';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export interface IngredientListProps {
  items: readonly IngredientOccurrence[];
  state: 'ready' | 'loading' | 'missing' | 'error';
  /** Show only the first N rows; the parent offers "All N ingredients". */
  limit?: number;
  focusedOccurrenceId?: string;
  onOpen: (occurrenceId: string) => void;
  onRetry: () => void;
}

export function matchLine(item: IngredientOccurrence): string {
  switch (item.match) {
    case 'matched':
      return enGB.ingredients.matched;
    case 'ambiguous':
      return enGB.ingredients.ambiguous;
    case 'unresolved':
      return enGB.ingredients.unresolved;
  }
}

/**
 * Component 12. The full ordered list including nested and unresolved terms.
 * No row says "safe" or "verified". Duplicates keep separate occurrence IDs,
 * so each row opens its own detail.
 */
export function IngredientList({
  items,
  state,
  limit,
  focusedOccurrenceId,
  onOpen,
  onRetry,
}: IngredientListProps) {
  const colors = useColors();

  if (state === 'loading') {
    return (
      <View
        accessibilityLiveRegion="polite"
        style={{ flexDirection: 'row', gap: space.s3, alignItems: 'center' }}
      >
        <ActivityIndicator color={colors.primary} />
        <AppText color="ink2">{enGB.ingredients.loading}</AppText>
      </View>
    );
  }
  if (state === 'error') {
    return (
      <View style={{ gap: space.s3 }}>
        <AppText color="ink2">{enGB.ingredients.error}</AppText>
        <Button label={enGB.common.retry} variant="outline" onPress={onRetry} />
      </View>
    );
  }
  if (state === 'missing' || items.length === 0) {
    return <AppText color="ink2">{enGB.ingredients.missing}</AppText>;
  }

  const visible = limit === undefined ? items : items.slice(0, limit);
  return (
    <View>
      {visible.map((item, index) => {
        const focused = item.occurrenceId === focusedOccurrenceId;
        return (
          <View key={item.occurrenceId}>
            {index > 0 ? <Divider /> : null}
            <Touchable
              accessibilityRole="button"
              accessibilityLabel={`${item.printedText}. ${matchLine(item)}${
                item.kind.kind === 'corrected'
                  ? `. ${enGB.provenance.corrected}`
                  : ''
              }`}
              radius={radius.sm}
              onPress={() => onOpen(item.occurrenceId)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: space.s3,
                paddingLeft: item.depth * space.s4,
                gap: space.s2,
                backgroundColor: focused ? colors.primarySoft : undefined,
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="subhead">{item.printedText}</AppText>
                <AppText variant="bodySm" color="ink2">
                  {matchLine(item)}
                  {item.kind.kind === 'corrected'
                    ? ` · ${enGB.provenance.corrected}`
                    : ''}
                </AppText>
              </View>
              <Icon name="chevron_right" color={colors.ink2} />
            </Touchable>
          </View>
        );
      })}
    </View>
  );
}
