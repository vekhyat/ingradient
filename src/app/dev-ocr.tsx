import { Redirect, useRouter } from 'expo-router';
import { useState } from 'react';

import { AppText } from '../components/AppText';
import { Button } from '../components/Button';
import {
  prepareEvaluationFolder,
  runDeviceEvaluation,
} from '../dev/ocr-eval/run-device';
import { ScreenFrame } from '../features/app/ScreenFrame';

function OcrEvaluationScreen() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    'No evaluation run. Prepare the folder, then copy private images, split.json and run.json using adb.',
  );
  return (
    <ScreenFrame
      title="OCR development evaluation"
      onBack={() => router.back()}
    >
      <AppText variant="body">
        Private development data. The selected split comes from run.json.
        Holdout requires a recorded freeze. Results remain in this app until you
        export them using adb.
      </AppText>
      <Button
        label="Prepare evaluation folder"
        variant="outline"
        busy={busy}
        onPress={() => {
          try {
            setMessage(prepareEvaluationFolder());
          } catch {
            setMessage(
              'Cannot prepare the app folder. Check the development build and storage.',
            );
          }
        }}
      />
      <Button
        label="Run configured split"
        variant="primary"
        busy={busy}
        onPress={() => {
          setBusy(true);
          void runDeviceEvaluation(setMessage)
            .then(setMessage)
            .catch((error: unknown) => {
              setMessage(
                error instanceof Error
                  ? error.message
                  : 'Evaluation failed. Check the folder and configuration.',
              );
            })
            .finally(() => setBusy(false));
        }}
      />
      <AppText variant="body" accessibilityLiveRegion="polite">
        {message}
      </AppText>
    </ScreenFrame>
  );
}

export default function DevOcrRoute() {
  return __DEV__ ? <OcrEvaluationScreen /> : <Redirect href="/" />;
}
