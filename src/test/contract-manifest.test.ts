/**
 * @jest-environment node
 */
/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The frozen contract is shared with the Python backend; an unrecorded edit must fail here.
const contractsDir = join(__dirname, '..', '..', 'contracts');

type Manifest = { contractVersion: string; sha256: Record<string, string> };

const manifest = JSON.parse(
  readFileSync(join(contractsDir, 'MANIFEST.json'), 'utf8'),
) as Manifest;

describe('frozen contract', () => {
  it.each(Object.entries(manifest.sha256))(
    '%s matches its pinned hash',
    (file, pinned) => {
      const actual = createHash('sha256')
        .update(readFileSync(join(contractsDir, file)))
        .digest('hex');
      expect(actual).toBe(pinned);
    },
  );

  it('names a contract version', () => {
    expect(manifest.contractVersion).toMatch(/^\d+\.\d+\.\d+(-[a-z]+)?$/);
  });
});
