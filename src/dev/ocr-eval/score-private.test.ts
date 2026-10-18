import { expect, test } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { parseGroundTruth, parseRun, parseSplit, SAFE_ID } from './dataset';
import { scorePhoto, summarise } from './metrics';
import { jsonObject, parseEvalResult } from './read-result';

const root = process.env.INGRADIENT_OCR_EVAL_DIR;
const runId = process.env.INGRADIENT_OCR_RUN;
const selectedSplit = process.env.INGRADIENT_OCR_SPLIT;
const privateTest = root ? test : test.skip;
function load(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}
function hash(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

privateTest(
  'score the explicit private device run without opening other splits',
  () => {
    if (
      !root ||
      !runId ||
      !SAFE_ID.test(runId) ||
      (selectedSplit !== 'dev' && selectedSplit !== 'holdout')
    ) {
      throw new Error(
        'Set INGRADIENT_OCR_EVAL_DIR, INGRADIENT_OCR_RUN and INGRADIENT_OCR_SPLIT (dev or holdout).',
      );
    }
    const privateRoot = realpathSync(root);
    const repo = realpathSync(path.resolve(__dirname, '../../..'));
    const relative = path.relative(repo, privateRoot);
    if (
      relative === '' ||
      (!relative.startsWith(`..${path.sep}`) &&
        relative !== '..' &&
        !path.isAbsolute(relative))
    ) {
      throw new Error('Keep private data outside the repository.');
    }
    const manifest = parseSplit(load(path.join(privateRoot, 'split.json')));
    const output = path.join(privateRoot, 'runs', runId);
    const metadata = jsonObject(load(path.join(output, 'run.json')));
    const run = parseRun(metadata.run);
    if (run.runId !== runId || run.split !== selectedSplit)
      throw new Error('Run/split mismatch.');
    expect(metadata.ids).toEqual(manifest[selectedSplit]);
    const evidence: {
      id: string;
      imageSha256: string;
      groundTruthSha256: string;
      resultSha256: string;
    }[] = [];
    const scores = manifest[selectedSplit].map((id) => {
      const resultPath = path.join(output, `${id}.json`);
      const goldPath = path.join(privateRoot, `${id}.json`);
      const result = parseEvalResult(load(resultPath));
      expect(result.run).toEqual(run);
      expect(result.id).toBe(id);
      expect(result.imageSha256).toBe(
        hash(path.join(privateRoot, `${id}.jpg`)),
      );
      evidence.push({
        id,
        imageSha256: result.imageSha256,
        groundTruthSha256: hash(goldPath),
        resultSha256: hash(resultPath),
      });
      return scorePhoto(parseGroundTruth(load(goldPath)), result);
    });
    const summary = summarise(scores);
    writeFileSync(
      path.join(output, 'scores.json'),
      `${JSON.stringify({ run, summary, splitSha256: hash(path.join(privateRoot, 'split.json')), evidence }, null, 2)}\n`,
      { flag: 'wx' },
    );
    // Aggregate counts only. No label text or per-photo transcriptions enter stdout.
    console.info(JSON.stringify({ run, summary }, null, 2));
  },
);
