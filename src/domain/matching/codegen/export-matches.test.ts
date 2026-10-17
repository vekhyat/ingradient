/** @jest-environment node */
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import fixtureJson from '../../../../resources/vectors/match-vectors.json';

const root = resolve(__dirname, '../../../..');
const cli = join(__dirname, 'export-matches.mjs');
const reviewedFixture = join(root, 'resources/vectors/match-vectors.json');

function runCli(env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [cli], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: {
      ...process.env,
      INGRADIENT_MATCH_VECTORS: reviewedFixture,
      ...env,
    },
  });
}

/** Writes an edited copy so the reviewed resource stays untouched. */
function runWithTamperedFixture(edit: (fixture: typeof fixtureJson) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'ingr-match-fixture-'));
  try {
    const fixture = structuredClone(fixtureJson);
    edit(fixture);
    const path = join(directory, 'match-vectors.json');
    writeFileSync(path, JSON.stringify(fixture));
    return runCli({ INGRADIENT_MATCH_VECTORS: path });
  } finally {
    if (
      dirname(resolve(directory)) !== resolve(tmpdir()) ||
      !basename(directory).startsWith('ingr-match-fixture-')
    ) {
      throw new Error('Unexpected matching fixture directory');
    }
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('exact-matching export CLI', () => {
  it('exports every reviewed vector from the actual TypeScript matcher', () => {
    const run = runCli();
    if (run.error) {
      throw run.error;
    }
    expect(run.status).toBe(0);
    expect(run.stderr).toBe('');
    const lines = run.stdout.split('\n').filter((line) => line !== '');
    expect(lines.length).toBe(37);
    const records: unknown[] = lines.map((line) => JSON.parse(line));
    expect(records).toEqual(
      fixtureJson.vectors.map((vector) => ({
        id: vector.id,
        scope: 'exact-matching',
        match: vector.expected,
      })),
    );
  }, 180000);

  it('refuses a tampered fixture pin without writing output', () => {
    const run = runWithTamperedFixture((fixture) => {
      const pin = fixture.sourcePins[0];
      if (!pin) throw new Error('Expected reviewed source pin');
      pin.sha256 = '0'.repeat(64);
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/fixture bundle/i);
  }, 30000);

  it('refuses an invalid fixture profile without writing output', () => {
    const run = runWithTamperedFixture((fixture) => {
      fixture.profile = 'fuzzy-inclusive';
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/profile/i);
  }, 30000);

  it('refuses a duplicate fixture id without writing output', () => {
    const run = runWithTamperedFixture((fixture) => {
      const first = fixture.vectors[0];
      const second = fixture.vectors[1];
      if (!first || !second) throw new Error('Expected reviewed vectors');
      second.id = first.id;
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe('');
    expect(run.stderr).toMatch(/repeats vector id/i);
  }, 30000);
});
