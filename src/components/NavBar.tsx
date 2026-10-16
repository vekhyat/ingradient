import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enGB } from '../copy/en-GB';
import { haptics } from '../motion/haptics';
import { useColors } from '../theme/ThemeProvider';
import { size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

export type RootTab = 'scan' | 'history' | 'you';

export interface NavBarProps {
  current: RootTab;
  onSelect: (next: RootTab) => void;
  /** True in the app: the bar adds the bottom safe area. False in the playground. */
  floating?: boolean;
}

const TABS: readonly { key: RootTab; icon: string; label: string }[] = [
  { key: 'scan', icon: 'barcode_scanner', label: enGB.nav.scan },
  { key: 'history', icon: 'history', label: enGB.nav.history },
  { key: 'you', icon: 'person', label: enGB.nav.you },
];

const INDICATOR_WIDTH = 56;
const INDICATOR_HEIGHT = size.navIndicatorHeight;

/**
 * Component 06 (D136). Three labelled roots on a docked bar with no top
 * border: the surface colour change is the edge, so the Scan camera meets it
 * cleanly. Labels are always visible and wrap at large text sizes; the
 * selected tab has a filled icon on a rounded tinted pill.
 */
export function NavBar({ current, onSelect, floating = true }: NavBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  const bar = (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        minHeight: size.navBar + (floating ? insets.bottom : 0),
        paddingBottom: floating ? insets.bottom : 0,
        paddingTop: space.s2,
        backgroundColor: colors.card,
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
            radius={28}
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
              paddingVertical: space.s1,
              gap: 2,
            }}
          >
            <View
              style={{
                width: INDICATOR_WIDTH,
                height: INDICATOR_HEIGHT,
                borderRadius: INDICATOR_HEIGHT / 2,
                overflow: 'hidden',
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

  return bar;
}
