import { View } from 'react-native';

import { AppText } from '../../components/AppText';
import { Card } from '../../components/Card';
import { enGB } from '../../copy/en-GB';
import { space } from '../../theme/tokens';

/**
 * ONB-01 notice text, versioned in services.NOTICE_VERSION. Marked as a
 * draft until the collection release review; it makes no legal-validity
 * claim (D72).
 */
export function NoticeBody() {
  return (
    <View style={{ gap: space.s4 }}>
      <Card>
        <AppText variant="label" color="ink2">
          {enGB.onboarding.draftMarker.toUpperCase()}
        </AppText>
      </Card>
      {enGB.onboarding.body.map((paragraph) => (
        <AppText key={paragraph}>{paragraph}</AppText>
      ))}
    </View>
  );
}
