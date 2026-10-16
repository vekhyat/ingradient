/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import {
  interpretNumberToken,
  parseAmountCell,
  repairAmountText,
} from './amount';
import { formatDecimal } from './decimal';

function numberText(token: string): string {
  const value = interpretNumberToken(token);
  if (value === 'ambiguous') {
    return 'ambiguous';
  }
  return formatDecimal(value);
}

describe('number tokens', () => {
  it('reads a decimal comma when the fraction is not a thousands group', () => {
    expect(numberText('0,5')).toBe('0.5');
    expect(numberText('12,50')).toBe('12.5');
    expect(numberText('0,500')).toBe('0.5');
  });

  it('does not guess a comma or dot that could be thousands or a decimal', () => {
    expect(numberText('1,000')).toBe('ambiguous');
    expect(numberText('1,500')).toBe('ambiguous');
    expect(numberText('12,345')).toBe('ambiguous');
    expect(numberText('1.234')).toBe('ambiguous');
    expect(numberText('10.500')).toBe('ambiguous');
  });

  it('reads grouped digits when the separators cannot swap roles', () => {
    expect(numberText('1,234.5')).toBe('1234.5');
    expect(numberText('1.234,5')).toBe('1234.5');
    expect(numberText('1.234.567')).toBe('1234567');
    expect(numberText('12.5')).toBe('12.5');
    expect(numberText('10.50')).toBe('10.5');
  });
});

function repairedText(input: string): {
  text: string;
  repairs: readonly string[];
} {
  const repaired = repairAmountText(input);
  if ('error' in repaired) {
    throw new Error(repaired.error);
  }
  return repaired;
}

describe('glyph and space repairs', () => {
  it('repairs O, l, and S only inside an otherwise numeric token', () => {
    const repaired = repairedText('1O.5 g');
    expect(repaired.text).toContain('10.5');
    expect(repaired.repairs.join(' ')).toContain('1O.5');
    expect(repairAmountText('Salt')).toEqual({ text: 'Salt', repairs: [] });
    expect(repairedText('l2 g').text).toContain('12');
    expect(repairedText('S.5 g').text).toContain('5.5');
  });

  it('joins a space that only splits a decimal mark, and rejects a space between digits', () => {
    expect(repairedText('12 .5 g').text.replace(/\s/g, '')).toContain('12.5');
    expect(repairedText('0 , 5 g').text.replace(/\s/g, '')).toContain('0,5');
    expect(repairedText('1 234 g').text).toContain('1234');
    expect(repairAmountText('1 2.5 g')).toEqual({
      error:
        'Digits are separated by a space, and those groups are not thousands.',
    });
  });
});

describe('cell markers', () => {
  it('keeps zero, Nil, a dash, and trace apart', () => {
    expect(parseAmountCell('0 g').status).toBe('quantity');
    expect(parseAmountCell('Nil').status).toBe('nil');
    expect(parseAmountCell('—').status).toBe('dash');
    expect(parseAmountCell('-').status).toBe('dash');
    expect(parseAmountCell('trace').status).toBe('trace');
    expect(parseAmountCell('<0.5 g').status).toBe('quantity');
    const bound = parseAmountCell('<0.5 g');
    expect(bound.status === 'quantity' && bound.quantities[0]?.bound).toBe(
      'lt',
    );
  });

  it('reads grams from the word and milligrams from the symbol', () => {
    const grams = parseAmountCell('2 grams');
    const milligrams = parseAmountCell('280 mg');
    expect(grams.status === 'quantity' && grams.quantities[0]?.unit).toBe('g');
    expect(
      milligrams.status === 'quantity' &&
        formatDecimal(
          milligrams.quantities[0]?.decimal ?? { significand: 0n, scale: 0 },
        ),
    ).toBe('280');
    expect(
      milligrams.status === 'quantity' && milligrams.quantities[0]?.unit,
    ).toBe('mg');
  });
});
