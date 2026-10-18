import { Redirect, useRouter } from 'expo-router';

import { Playground } from '../dev/Playground';
import { ScreenFrame } from '../features/app/ScreenFrame';
import { Button } from '../components/Button';
import { getLocalScenario } from '../fixtures/scenarios';
import { useServices } from '../features/app/services';

/**
 * FE-03 playground route. Production builds redirect away, so fixtures can
 * never appear to a real user.
 */
export default function DevRoute() {
  const router = useRouter();
  const { scan, label } = useServices();
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return (
    <ScreenFrame title="Component playground" onBack={() => router.back()}>
      <Button
        label="FICTIONAL: preview result screen"
        variant="outline"
        onPress={() => {
          const fixture = getLocalScenario('complete_graded');
          const key = scan.addResult(
            {
              ...fixture.snapshot,
              name: `FICTIONAL · ${fixture.snapshot.name}`,
            },
            fixture.assessment,
            'phone',
          );
          router.push({ pathname: '/result/[key]', params: { key } });
        }}
      />
      <Button
        label="FICTIONAL: try captured label flow"
        variant="outline"
        onPress={() => {
          const fixture = getLocalScenario('complete_graded').snapshot;
          label.start({ ...fixture, name: `FICTIONAL · ${fixture.name}` });
          if (router.canDismiss()) router.dismissAll();
          else router.replace('/');
        }}
      />
      <Button
        label="OCR development evaluation"
        variant="outline"
        onPress={() => router.push('/dev-ocr')}
      />
      <Playground />
    </ScreenFrame>
  );
}
