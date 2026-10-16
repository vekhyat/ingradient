import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enGB } from '../copy/en-GB';
import { haptics } from '../motion/haptics';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export type RootTab = 'scan' | 'history' | 'you';

export interface NavBarProps {
  current: RootTab;
  onSelect: (next: RootTab) => void;
}

const TABS: readonly { key: RootTab; icon: string; label: string }[] = [
  { key: 'scan', icon: 'barcode_scanner', label: enGB.nav.scan },
  { key: 'history', icon: 'history', label: enGB.nav.history },
  { key: 'you', icon: 'person', label: enGB.nav.you },
];

/**
 * Component 06. Three labelled roots. Labels are always visible and wrap at
 * large text sizes. The selected tab has a filled icon on a pill.
 */
export function NavBar({ current, onSelect }: NavBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        minHeight: size.navBar + insets.bottom,
        paddingBottom: insets.bottom,
        backgroundColor: colors.card,
        borderTopWidth: 1,
        borderTopColor: colors.hair,
      }}
    >
      {TABS.map((tab) => {
        const selected = tab.key === current;
        return (
          <Touchable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) {
                haptics.play('selection');
              }
              onSelect(tab.key);
            }}
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: space.s3,
              gap: space.s1,
            }}
          >
            <View
              style={{
                minWidth: size.navIndicatorWidth,
                minHeight: size.navIndicatorHeight,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: selected ? colors.primarySoft : 'transparent',
              }}
            >
              <Icon
                name={tab.icon}
                filled={selected}
                color={selected ? colors.onPrimarySoft : colors.ink2}
              />
            </View>
            <AppText
              variant="label"
              color={selected ? 'ink' : 'ink2'}
              style={{ textAlign: 'center' }}
            >
              {tab.label}
            </AppText>
          </Touchable>
        );
      })}
    </View>
  );
}
