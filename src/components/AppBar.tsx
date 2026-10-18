import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { enGB } from '../copy/en-GB';
import { useColors } from '../theme/ThemeProvider';
import { radius, size, space } from '../theme/tokens';
import { AppText } from './AppText';
import { Touchable } from './Touchable';
import { useInitialFocus } from './useInitialFocus';

export interface AppBarProps {
  title: string;
  onBack: () => void;
  /** S1–S4 pass none; the slot is reserved for a later accepted export. */
  action?: { kind: 'none' };
}

/**
 * Component 05. A printed running head: an underlined BACK on the left and
 * the page name in small capitals in the middle. The title wraps instead of
 * truncating, and is the screen heading for screen readers.
 */
export function AppBar({ title, onBack }: AppBarProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const titleRef = useInitialFocus();
  return (
    <View style={{ paddingTop: insets.top, backgroundColor: colors.bg }}>
      <View
        style={{
          minHeight: size.appBar,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: space.s2,
        }}
      >
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          <Touchable
            accessibilityRole="button"
            accessibilityLabel={enGB.common.back}
            radius={radius.sm}
            onPress={onBack}
            style={{ justifyContent: 'center', paddingHorizontal: space.s3 }}
          >
            <AppText
              variant="label"
              style={{ textDecorationLine: 'underline' }}
            >
              {enGB.common.back}
            </AppText>
          </Touchable>
        </View>
        <AppText
          ref={titleRef}
          variant="label"
          heading
          style={{ flexShrink: 1, maxWidth: '50%', textAlign: 'center' }}
        >
          {title}
        </AppText>
        <View style={{ flex: 1 }} />
      </View>
    </View>
  );
}
