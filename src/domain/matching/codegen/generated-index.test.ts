/** @jest-environment node */
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

describe('pinned matching index', () => {
  it('matches the source-derived generator byte for byte', () => {
    const generator = pathToFileURL(join(__dirname, 'build-index.mjs')).href;
    const generated = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `import { generateIndex } from ${JSON.stringify(generator)}; process.stdout.write(await generateIndex());`,
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    if (generated.error || generated.status !== 0) {
      throw new Error(
        generated.error?.message ??
          generated.stderr ??
          'Index generation failed',
      );
    }
    expect(generated.stdout).toBe(
      readFileSync(join(__dirname, '../generated/taxonomy-index.json'), 'utf8'),
    );
  }, 30000);
});
