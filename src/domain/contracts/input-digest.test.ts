/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, inputDigest, inputDigestOfRequestBody } from './input-digest';

interface DigestVector {
  name: string;
  kind: string;
  value: unknown;
  canonical: string;
  sha256: string;
}

function isDigestVector(value: unknown): value is DigestVector {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'kind') === 'string' &&
    typeof Reflect.get(value, 'canonical') === 'string' &&
    typeof Reflect.get(value, 'sha256') === 'string' &&
    'value' in value
  );
}

function readVectors(): DigestVector[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(__dirname, '..', '..', '..', 'contracts', 'vectors', 'input-digest.json'), 'utf8'),
  );
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('input-digest vectors must be an object.');
  }
  const cases: unknown = Reflect.get(parsed, 'cases');
  if (!Array.isArray(cases) || !cases.every(isDigestVector)) {
    throw new Error('input-digest cases are missing canonical output.');
  }
  return cases;
}

const vectors = readVectors();

describe('inputDigest', () => {
  it.each(vectors)('$name', (vector) => {
    expect(canonicalJson(vector.value)).toBe(vector.canonical);
    expect(inputDigest(vector.value)).toBe(vector.sha256);
  });

  it('hashes the product of the exact request body', () => {
    const product = vectors.find((vector) => vector.name === 'optional name absent');
    const named = vectors.find((vector) => vector.name === 'optional name present as null');
    expect(product).toBeDefined();
    expect(named).toBeDefined();
    if (product === undefined || named === undefined) {
      return;
    }
    const absentBody = JSON.stringify({ contractVersion: '0.3.0-draft', product: product.value });
    const nullBody = JSON.stringify({ contractVersion: '0.3.0-draft', product: named.value });
    expect(inputDigestOfRequestBody(absentBody)).toBe(product.sha256);
    expect(inputDigestOfRequestBody(nullBody)).toBe(named.sha256);
    expect(product.sha256).not.toBe(named.sha256);
  });

  it('rejects a body with no product value', () => {
    expect(() => inputDigestOfRequestBody('{"contractVersion":"0.3.0-draft"}')).toThrow(
      /product/,
    );
  });
});
