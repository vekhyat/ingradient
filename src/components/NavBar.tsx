import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enGB } from '../copy/en-GB';
import { haptics } from '../motion/haptics';
import { useColors } from '../theme/ThemeProvider';
import { size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Touchable } from './Touchable';

export type RootTab = 'scan' | 'history' | 'you';

export interface NavBarProps {
  current: RootTab;
  onSelect: (next: RootTab) => void;
  /** True in the app: the bar adds the bottom safe area. False in the playground. */
  floating?: boolean;
}

const TABS: readonly { key: RootTab; label: string }[] = [
  { key: 'scan', label: enGB.nav.scan },
  { key: 'history', label: enGB.nav.history },
  { key: 'you', label: enGB.nav.you },
];

/**
 * Component 06. Three labelled roots as printed small capitals on paper, no
 * icons and no pill. The selected tab is ink with a turmeric bar under it;
 * the others are quieter ink. Labels wrap at large text sizes.
 */
export function NavBar({ current, onSelect, floating = true }: NavBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        minHeight: size.navBar + (floating ? insets.bottom : 0),
        paddingBottom: (floating ? insets.bottom : 0) + space.s2,
        backgroundColor: colors.bg,
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
              gap: space.s2,
            }}
          >
            <AppText
              variant="label"
              color={selected ? 'ink' : 'ink3'}
              style={{ textAlign: 'center' }}
            >
              {tab.label}
            </AppText>
            <View
              style={{
                width: 48,
                height: 3,
                backgroundColor: selected ? colors.accent : 'transparent',
              }}
            />
          </Touchable>
        );
      })}
    </View>
  );
}
