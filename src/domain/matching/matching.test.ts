import { describe, expect, it } from '@jest/globals';
import { parseIngredients } from '../ingredients';
import { DEFAULT_TAXONOMY_VERSION } from '../../adapters/catalogue/types';
import {
  matchIngredient,
  matchIngredientMentions,
  MATCH_TAXONOMY_VERSION,
} from './index';

describe('source-backed exact matching', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'treats inherited object property %s as unresolved',
    (text) => {
      expect(matchIngredient(text)).toEqual({
        state: 'unresolved',
        canonicalId: null,
        candidateIds: [],
      });
    },
  );

  it.each([
    ['E100', 'en:e100'],
    ['E 100', 'en:e100'],
    ['INS503(ii)', 'en:e503(ii)'],
    ['E503 ( ii )', 'en:e503(ii)'],
    ['E160a(i)', 'en:e160a(i)'],
    ['E150d', 'en:e150d'],
    ['salt', 'en:salt'],
    ['1% fat milk', 'en:skimmed-milk'],
    ['3% fat reduced cocoa powder', 'en:3%-fat-reduced-cocoa-powder'],
  ])('preserves source identity for %s', (text, id) => {
    expect(matchIngredient(text)).toEqual({
      state: 'matched',
      canonicalId: id,
      candidateIds: [id],
    });
  });
  it.each([
    '503',
    '503(ii)',
    'E150(d)',
    'E503(vv)',
    'E503(ii)(i)',
    'E100garbage',
    'E9999',
    'INS503[ ii ]',
  ])('refuses %s without generalising', (text) => {
    expect(matchIngredient(text)).toEqual({
      state: 'unresolved',
      canonicalId: null,
      candidateIds: [],
    });
  });
  it('requires class context for a bare code', () => {
    expect(
      matchIngredient('503(ii)', { additiveContext: true }).canonicalId,
    ).toBe('en:e503(ii)');
  });
  it.each(['atta', 'maida'])(
    'preserves conflicting source aliases %s',
    (text) => {
      const result = matchIngredient(text);
      expect(result.state).toBe('ambiguous');
      expect(result.canonicalId).toBeNull();
      expect(result.candidateIds.length).toBeGreaterThan(1);
    },
  );
  it('does not flatten origin or parent relationships', () => {
    expect(matchIngredient('turmeric').canonicalId).not.toBe('en:e100');
    expect(matchIngredient('wheat flour').canonicalId).not.toBe('en:wheat');
  });
  it('fuzzy suggestions never create an identity', () => {
    expect(matchIngredient('sallt')).toEqual({
      state: 'unresolved',
      canonicalId: null,
      candidateIds: [],
    });
    const result = matchIngredient('sallt', { fuzzy: true });
    expect(result.state).toBe('unresolved');
    expect(result.canonicalId).toBeNull();
    expect(result.candidateIds).toContain('en:salt');
  });
});

describe('parsed mention matching', () => {
  const context = {
    sourceIds: ['label-1'],
    taxonomyVersion: MATCH_TAXONOMY_VERSION,
  };
  it.each(['E150(q)', 'E160a(i)(q)'])(
    'does not match a truncated identity from %s',
    (text) => {
      const result = matchIngredientMentions(parseIngredients(text), context);
      expect(result.mentions).toHaveLength(1);
      expect(result.mentions[0]).toMatchObject({
        text,
        state: 'unresolved',
        canonicalId: null,
        candidateIds: [],
      });
    },
  );

  it('keeps original source/nesting and separates may contain', () => {
    const result = matchIngredientMentions(
      parseIngredients('salt, sauce(sugar). May contain: milk'),
      context,
    );
    expect(result.mentions.find((m) => m.text === 'salt')?.canonicalId).toBe(
      'en:salt',
    );
    expect(result.mentions.every((m) => m.sourceIds[0] === 'label-1')).toBe(
      true,
    );
    expect(result.coverage.allergenStatementsOmitted).toBeGreaterThan(0);
    expect(
      result.mentions.some((m) => m.text.toLowerCase().includes('may contain')),
    ).toBe(false);
  });
  it('refuses a different taxonomy edition', () => {
    const result = matchIngredientMentions(parseIngredients('salt'), {
      ...context,
      taxonomyVersion: 'old',
    });
    expect(result.mentions[0]?.state).toBe('unresolved');
    expect(result.issues[0]?.code).toBe('matching_taxonomy_incompatible');
  });
  it('accepts the catalogue default resource edition', () => {
    const result = matchIngredientMentions(parseIngredients('salt'), {
      ...context,
      taxonomyVersion: DEFAULT_TAXONOMY_VERSION,
    });
    expect(result.issues).toEqual([]);
    expect(result.mentions[0]?.canonicalId).toBe('en:salt');
  });
  it('retains specific suffix atoms through existing parser', () => {
    const result = matchIngredientMentions(
      parseIngredients('Colour(E160a(i))'),
      context,
    );
    expect(
      result.mentions.find((m) => m.canonicalId === 'en:e160a(i)'),
    ).toBeDefined();
  });
});
