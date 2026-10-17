import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { matchIngredient } from './index';

describe('independently source-derived exact vectors', () => {
  it('runs every shared fixture against the actual TypeScript matcher', () => {
    const path =
      process.env.INGRADIENT_MATCH_VECTORS ??
      resolve('resources/vectors/match-vectors.json');
    const fixture: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (
      typeof fixture !== 'object' ||
      fixture === null ||
      !('vectors' in fixture) ||
      !Array.isArray(fixture.vectors)
    )
      throw new Error('Missing shared matching vectors');
    for (const vector of fixture.vectors) {
      // This engineering fixture is reviewed independently; reject malformed input.
      if (
        typeof vector !== 'object' ||
        vector === null ||
        typeof vector.id !== 'string' ||
        typeof vector.input?.text !== 'string' ||
        typeof vector.input?.additiveContext !== 'boolean'
      )
        throw new Error('Invalid shared match vector');
      expect({
        id: vector.id,
        actual: matchIngredient(vector.input.text, {
          additiveContext: vector.input.additiveContext,
        }),
      }).toEqual({ id: vector.id, actual: vector.expected });
    }
    expect(fixture.vectors.length).toBeGreaterThan(0);
  });
});
