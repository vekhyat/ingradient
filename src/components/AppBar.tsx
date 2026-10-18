import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';
import { useInitialFocus } from './useInitialFocus';

export interface AppBarProps {
  title: string;
  onBack: () => void;
  /** S1–S4 pass none; the slot is reserved for a later accepted export. */
  action?: { kind: 'none' };
}

/**
 * Component 05. Names the page and offers Back. The title wraps instead of
 * truncating a product name, and is the screen heading for screen readers.
 */
export function AppBar({ title, onBack }: AppBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const titleRef = useInitialFocus();
  return (
    <View
      style={{
        paddingTop: insets.top,
        backgroundColor: colors.bg,
      }}
    >
      <View
        style={{
          minHeight: size.appBar,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.s1,
          gap: space.s1,
        }}
      >
        <Touchable
          accessibilityRole="button"
          accessibilityLabel={enGB.common.back}
          radius={radius.full}
          onPress={onBack}
          style={{
            width: size.targetMin,
            height: size.targetMin,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="arrow_back" color={colors.ink} />
        </Touchable>
        <AppText
          ref={titleRef}
          variant="title"
          heading
          style={{ flex: 1, paddingVertical: space.s3, paddingRight: space.s4 }}
        >
          {title}
        </AppText>
      </View>
    </View>
  );
}
