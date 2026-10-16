import { Redirect, useRouter } from 'expo-router';

import { Playground } from '../dev/Playground';
import { ScreenFrame } from '../features/app/ScreenFrame';

/**
 * FE-03 playground route. Production builds redirect away, so fixtures can
 * never appear to a real user.
 */
export default function DevRoute() {
  const router = useRouter();
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return (
    <ScreenFrame title="Component playground" onBack={() => router.back()}>
      <Playground />
    </ScreenFrame>
  );
}
