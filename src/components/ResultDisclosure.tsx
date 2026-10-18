import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { useColors } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { AppText } from './AppText';
import { Icon } from './Icon';
import { Touchable } from './Touchable';

/** Keep supporting detail on the result without making it compete with the answer. */
export function ResultDisclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={{ borderTopWidth: 1, borderTopColor: colors.hair }}>
      <Touchable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s3,
          paddingVertical: space.s3,
        }}
      >
        <AppText variant="subhead" style={{ flex: 1 }}>
          {title}
        </AppText>
        <Icon
          name={expanded ? 'expand_less' : 'expand_more'}
          color={colors.ink2}
        />
      </Touchable>
      {expanded ? (
        <View style={{ paddingBottom: space.s3 }}>{children}</View>
      ) : null}
    </View>
  );
}
