import { useRouter } from 'expo-router';

import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { enGB } from '../copy/en-GB';
import { ScreenFrame } from '../features/app/ScreenFrame';
import { space } from '../theme/tokens';

/** General method information, opened from You. */
export default function AboutMethodScreen() {
  const router = useRouter();
  return (
    <ScreenFrame title={enGB.you.method} onBack={() => router.back()}>
      <Card style={{ gap: space.s3 }}>
        <AppText variant="heading" heading>
          {enGB.assessment.methodLabel}
        </AppText>
        <AppText color="ink2">{enGB.method.noMethod}</AppText>
        <AppText color="ink2">{enGB.method.notOfficial}</AppText>
      </Card>
    </ScreenFrame>
  );
}
