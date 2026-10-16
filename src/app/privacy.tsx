import { useRouter } from 'expo-router';

import { AppText } from '../components/AppText';
import { enGB } from '../copy/en-GB';
import { ScreenFrame } from '../features/app/ScreenFrame';
import { NoticeBody } from '../features/onboarding/NoticeBody';

/** The accepted notice, readable again from You. */
export default function PrivacyScreen() {
  const router = useRouter();
  return (
    <ScreenFrame title={enGB.you.privacy} onBack={() => router.back()}>
      <NoticeBody />
      <AppText variant="bodySm" color="ink3">
        {enGB.you.requestsBody}
      </AppText>
    </ScreenFrame>
  );
}
