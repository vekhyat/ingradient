import type { ReactNode } from 'react';
import {
  ScrollView,
  View,
  type ScrollView as ScrollViewType,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar } from '../../components/AppBar';
import { useColors } from '../../theme/ThemeProvider';
import { space } from '../../theme/tokens';

/**
 * A pushed screen: App bar, scrolling body and an optional bottom dock for
 * the screen's main action. The body's bottom padding leaves room for the
 * dock and the safe area, so the last row is never hidden.
 */
export function ScreenFrame({
  title,
  onBack,
  children,
  dock,
  scrollRef,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
  dock?: ReactNode;
  scrollRef?: React.Ref<ScrollViewType>;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <AppBar title={title} onBack={onBack} />
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          padding: space.s5 - space.s1,
          gap: space.s5,
          paddingBottom: dock ? space.s4 : insets.bottom + space.s5,
        }}
      >
        {children}
      </ScrollView>
      {dock ? (
        <View
          style={{
            paddingHorizontal: space.s5 - space.s1,
            paddingTop: space.s4,
            paddingBottom: insets.bottom + space.s4,
            backgroundColor: colors.bg,
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: space.s3,
          }}
        >
          {dock}
        </View>
      ) : null}
    </View>
  );
}

/** Lays out up to two dock buttons; they stack when they do not fit. */
export function DockItem({ children }: { children: ReactNode }) {
  return <View style={{ flexGrow: 1, flexBasis: 160 }}>{children}</View>;
}
