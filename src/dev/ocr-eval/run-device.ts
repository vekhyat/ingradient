import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { recogniseLabel } from '../../adapters/native/text-recognition';
import { parseRun, parseSplit } from './dataset';
import { buildEvalResult } from './pipeline';

export function evaluationFolder(): Directory {
  return new Directory(Paths.document, 'ocr-eval');
}

export function prepareEvaluationFolder(): string {
  if (!__DEV__) throw new Error('OCR evaluation is development-only.');
  const root = evaluationFolder();
  root.create({ intermediates: true, idempotent: true });
  new Directory(root, 'images').create({ idempotent: true });
  return root.uri;
}

/** Never enumerate holdout by default. The explicit run config chooses one split. */
export async function runDeviceEvaluation(
  onProgress: (message: string) => void,
): Promise<string> {
  if (!__DEV__) throw new Error('OCR evaluation is development-only.');
  const root = evaluationFolder();
  const split = parseSplit(
    JSON.parse(await new File(root, 'split.json').text()),
  );
  const run = parseRun(JSON.parse(await new File(root, 'run.json').text()));
  const images = split[run.split].map((id) => ({
    id,
    file: new File(root, 'images', `${id}.jpg`),
  }));
  if (images.some(({ file }) => !file.exists))
    throw new Error(
      'Missing image: each selected ID needs images/<id>.jpg. No run started.',
    );
  const output = new Directory(root, 'runs', run.runId);
  if (output.exists)
    throw new Error(
      'This runId already exists. Preserve it and choose a new runId.',
    );
  output.create({ intermediates: true });
  const metadata = new File(output, 'run.json');
  metadata.create();
  metadata.write(
    JSON.stringify(
      {
        run,
        ids: split[run.split],
        platform: Platform.OS,
        osVersion: Platform.Version,
        engine: '@react-native-ml-kit/text-recognition@2.0.0',
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  for (const [index, { id, file }] of images.entries()) {
    onProgress(`${run.split}: ${index + 1} of ${images.length}`);
    const capturedAt = new Date().toISOString();
    const imageSha256 = bytesToHex(sha256(await file.bytes()));
    const started = performance.now();
    const outcome = await recogniseLabel(file.uri);
    const result = buildEvalResult({
      id,
      imageSha256,
      run,
      capturedAt,
      elapsedMs: 0,
      outcome,
    });
    result.elapsedMs = performance.now() - started;
    const target = new File(output, `${id}.json`);
    target.create();
    target.write(JSON.stringify(result, null, 2));
  }
  return `Saved ${images.length} results in ${output.uri}`;
}
