/**
 * @jest-environment node
 */
/// <reference types="node" />
import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = join(__dirname, '..', '..', '..', '..');

function generatedSources(): Record<string, string> {
  const generatorUrl = pathToFileURL(join(__dirname, 'generate.mjs')).href;
  const script = `
import { generateArtifacts } from ${JSON.stringify(generatorUrl)};
const artifacts = await generateArtifacts();
process.stdout.write(JSON.stringify(artifacts));
`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `Generator exited ${result.status ?? 'unknown'}.`);
  }
  const parsed: unknown = JSON.parse(result.stdout);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Generator did not return an artifact map.');
  }
  const artifacts: Record<string, string> = {};
  for (const [name, source] of Object.entries(parsed)) {
    if (typeof source !== 'string') {
      throw new Error(`Generated ${name} is not text.`);
    }
    artifacts[name] = source;
  }
  return artifacts;
}

describe('generated contract artifacts', () => {
  it('match the generator byte for byte', () => {
    const artifacts = generatedSources();
    expect(Object.keys(artifacts).sort()).toEqual([
      'local.ts',
      'validate-local.d.ts',
      'validate-local.js',
      'validate-wire.d.ts',
      'validate-wire.js',
      'wire.ts',
    ]);
    for (const [name, source] of Object.entries(artifacts)) {
      const committed = readFileSync(join(__dirname, '..', 'generated', name), 'utf8');
      const hasHeader =
        committed.startsWith('/**\n * generated, do not edit') ||
        committed.startsWith('/* eslint-disable */');
      expect(hasHeader).toBe(true);
      expect(source).toBe(committed);
    }
  }, 180000);
});
