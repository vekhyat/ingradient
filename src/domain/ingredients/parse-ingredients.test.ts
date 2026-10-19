/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';
import {
  INGREDIENT_MENTION_LIMIT,
  INGREDIENT_PANEL_TEXT_LIMIT,
} from './limits';
import { parseIngredients } from './parse-ingredients';
import {
  toExtractionIssues,
  toIngredientMentions,
} from './to-ingredient-mentions';
import type {
  AdditiveIdentity,
  IngredientParseResult,
  ParsedMention,
} from './types';

function parsed(input: string): IngredientParseResult {
  return parseIngredients(input);
}

function names(input: string): string[] {
  return parsed(input).mentions.map((mention) => mention.name);
}

function additives(input: string): AdditiveIdentity[] {
  return parsed(input)
    .mentions.map((mention) => mention.additive)
    .filter((additive): additive is AdditiveIdentity => additive !== null);
}

function codes(input: string): string[] {
  return additives(input).map((additive) => additive.code);
}

function byName(result: IngredientParseResult, name: string): ParsedMention {
  const found = result.mentions.find((mention) => mention.name === name);
  if (!found) {
    throw new Error(
      `Missing mention ${name}. Saw ${result.mentions.map((mention) => mention.name).join(' | ')}`,
    );
  }
  return found;
}

function assertSpans(input: string): void {
  const result = parsed(input);
  expect(result.text).toBe(input);
  const byId = new Map(result.mentions.map((mention) => [mention.id, mention]));
  expect(byId.size).toBe(result.mentions.length);
  for (const mention of result.mentions) {
    expect(input.slice(mention.span.start, mention.span.end)).toBe(
      mention.text,
    );
    expect(mention.span.start).toBeGreaterThanOrEqual(0);
    expect(mention.span.end).toBeLessThanOrEqual(input.length);
    if (mention.parentId) {
      const parent = byId.get(mention.parentId);
      expect(parent).toBeDefined();
      if (parent) {
        expect(mention.span.start).toBeGreaterThanOrEqual(parent.span.start);
        expect(mention.span.end).toBeLessThanOrEqual(parent.span.end);
      }
    }
    if (mention.additive) {
      expect(
        input.slice(mention.additive.span.start, mention.additive.span.end),
      ).toBe(mention.additive.written);
      if (mention.additive.suffix) {
        expect(mention.additive.code.endsWith(mention.additive.suffix)).toBe(
          true,
        );
      }
    }
    if (mention.percentage) {
      expect(
        input.slice(mention.percentage.span.start, mention.percentage.span.end),
      ).toBe(mention.percentage.text);
      expect(mention.span.start).toBeLessThanOrEqual(
        mention.percentage.span.start,
      );
      expect(mention.percentage.span.end).toBeLessThanOrEqual(mention.span.end);
    }
  }
}

describe('parseIngredients', () => {
  it.each([
    'E150(q)',
    'E160a(i)(q)',
    'E150(q7)',
    'INS 150 (q)',
    'E150[q]',
    '150(q)',
  ])('keeps unsupported code suffixes attached in %s', (text) => {
    expect(names(text)).toEqual([text]);
    expect(codes(text)).toEqual([]);
    expect(codes(`Colour (${text})`)).toEqual([]);
    assertSpans(text);
  });

  it.each([
    ['E150', 'caramel'],
    ['E322', 'soy'],
  ])('keeps word groups as children after %s', (code, child) => {
    const result = parsed(`${code} (${child})`);
    expect(result.mentions.map((mention) => mention.name)).toEqual([
      code,
      child,
    ]);
    expect(result.mentions[1]?.parentId).toBe(result.mentions[0]?.id);
    expect(codes(`${code} (${child})`)).toEqual([code.slice(1)]);
  });

  it.each([
    ['< 2%', 'maximum'],
    ['<= 2%', 'maximum'],
    ['\u2264 2%', 'maximum'],
    ['less than 2%', 'maximum'],
    ['> 2%', 'minimum'],
    ['>= 2%', 'minimum'],
    ['\u2265 2%', 'minimum'],
    ['more than 2%', 'minimum'],
  ])('keeps percentage bound %s on its ingredient', (bound, qualifier) => {
    const input = `Sugar (${bound})`;
    const result = parsed(input);
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.name).toBe('Sugar');
    expect(result.mentions[0]?.percentage).toMatchObject({
      text: bound,
      value: 2,
      qualifier,
    });
    expect(result.mentions[0]?.percentage?.qualifier).not.toBe('exact');
    assertSpans(input);
  });

  it('recognises additive classes separated by a colon', () => {
    expect(codes('Emulsifiers: 322, 471')).toEqual(['322', '471']);
    expect(codes('Emulsifiers: 500 g, 2024')).toEqual([]);
    expect(codes('Emulsifiers: 322, sugar, 471')).toEqual(['322']);
    expect(codes('preservative free: 322')).toEqual([]);
    assertSpans('Emulsifiers: 322, 471');
  });

  it('keeps a suffix after multiple OCR whitespace characters', () => {
    expect(codes('INS 503  (ii)')).toEqual(['503(ii)']);
    expect(codes('INS 503\t (II)')).toEqual(['503(II)']);
    assertSpans('INS 503  (ii)');
  });

  it('preserves printed parenthetical additive letter suffixes', () => {
    const result = parsed('Colour (150(a))');
    expect(result.mentions.map((mention) => mention.name)).not.toContain('a');
    expect(codes('Colour (150(a))')).toEqual(['150(a)']);
    assertSpans('Colour (150(a))');
  });

  it('keeps product lead-ins with their allergen statements', () => {
    const result = parsed('Wheat flour, sugar. This product may contain milk.');
    expect(result.mentions.map((mention) => mention.name)).toEqual([
      'Wheat flour',
      'sugar',
      'milk',
    ]);
    expect(result.mentions[2]?.role).toBe('allergen_may_contain');
  });

  it('nests parentheses and keeps parent order', () => {
    const input =
      'Chocolate (sugar, cocoa mass (cocoa butter, cocoa solids), milk)';
    const result = parsed(input);
    const chocolate = byName(result, 'Chocolate');
    const children = result.mentions.filter(
      (mention) => mention.parentId === chocolate.id,
    );
    expect(children.map((mention) => mention.name)).toEqual([
      'sugar',
      'cocoa mass',
      'milk',
    ]);
    const mass = byName(result, 'cocoa mass');
    expect(
      result.mentions
        .filter((mention) => mention.parentId === mass.id)
        .map((mention) => mention.name),
    ).toEqual(['cocoa butter', 'cocoa solids']);
    expect(mass.depth).toBeGreaterThan(chocolate.depth);
  });

  it('keeps two suffixed codes under square brackets', () => {
    const input = 'Raising agents [503(ii), 500(ii)]';
    const result = parsed(input);
    expect(byName(result, 'Raising agents').additiveClass).toBe(
      'raising agents',
    );
    expect(codes(input)).toEqual(['503(ii)', '500(ii)']);
    const first = additives(input)[0];
    expect(first?.suffix).toBe('(ii)');
    expect(first?.code).not.toBe('503');
    expect(input.slice(first?.span.start, first?.span.end)).toBe('503(ii)');
  });

  it('nests curly braces', () => {
    const result = parsed('Flour {wheat, malted barley}');
    const flour = byName(result, 'Flour');
    expect(
      result.mentions
        .filter((mention) => mention.parentId === flour.id)
        .map((mention) => mention.name),
    ).toEqual(['wheat', 'malted barley']);
  });

  it('nests mixed bracket kinds', () => {
    const result = parsed('Sauce (tomato, spice [chilli, salt])');
    const spice = byName(result, 'spice');
    expect(
      result.mentions
        .filter((mention) => mention.parentId === spice.id)
        .map((mention) => mention.name),
    ).toEqual(['chilli', 'salt']);
    expect(spice.parentId).toBe(byName(result, 'Sauce').id);
  });

  it('reads a percentage in parentheses', () => {
    const mention = byName(parsed('Wheat flour (63%)'), 'Wheat flour');
    expect(mention.percentage?.value).toBe(63);
    expect(mention.percentage?.qualifier).toBe('exact');
    expect(mention.percentage?.text).toContain('63');
    expect(additives('Wheat flour (63%)')).toEqual([]);
  });

  it('reads a trailing percentage with a space before the sign', () => {
    const mention = byName(parsed('Sugar 12.5 %'), 'Sugar');
    expect(mention.percentage?.value).toBe(12.5);
    expect(mention.percentage?.text).toBe('12.5 %');
  });

  it('reads a minimum percentage', () => {
    const mention = byName(parsed('Cocoa solids (min. 20%)'), 'Cocoa solids');
    expect(mention.percentage?.qualifier).toBe('minimum');
    expect(mention.percentage?.value).toBe(20);
  });

  it('reads a maximum percentage', () => {
    const mention = byName(parsed('Fat (max. 5%)'), 'Fat');
    expect(mention.percentage?.qualifier).toBe('maximum');
    expect(mention.percentage?.value).toBe(5);
  });

  it('reads an approximate percentage', () => {
    expect(
      byName(parsed('Nuts (approx. 8%)'), 'Nuts').percentage?.qualifier,
    ).toBe('approximate');
    expect(byName(parsed('Milk (about 2%)'), 'Milk').percentage?.value).toBe(2);
  });

  it('keeps a European decimal comma on one ingredient', () => {
    const result = parsed('Sugar 12,5 %');
    expect(result.mentions).toHaveLength(1);
    expect(result.mentions[0]?.name).toBe('Sugar');
    expect(result.mentions[0]?.percentage?.value).toBe(12.5);
    expect(additives('Sugar 12,5 %')).toEqual([]);
  });

  it('puts a group percentage on the parent and still nests the oils', () => {
    const result = parsed('Vegetable oil (sunflower, palm) (30%)');
    const oil = byName(result, 'Vegetable oil');
    expect(oil.percentage?.value).toBe(30);
    expect(
      result.mentions
        .filter((mention) => mention.parentId === oil.id)
        .map((mention) => mention.name),
    ).toEqual(['sunflower', 'palm']);
  });

  it('keeps an unclosed parenthesis as one raw span', () => {
    const input = 'salt, Sugar (brown';
    const result = parsed(input);
    const raw = result.mentions.find((mention) =>
      mention.issues.some((issue) => issue.code === 'unbalanced_brackets'),
    );
    expect(raw).toBeDefined();
    if (!raw) {
      return;
    }
    expect(input.slice(raw.span.start, raw.span.end)).toBe(raw.text);
    expect(raw.text).toContain('Sugar');
    expect(result.mentions.some((mention) => mention.name === 'brown')).toBe(
      false,
    );
    expect(result.mentions.some((mention) => mention.name === 'salt')).toBe(
      true,
    );
    expect(result.mentions.some((mention) => mention.parentId === raw.id)).toBe(
      false,
    );
  });

  it('does not throw on a spare closing parenthesis', () => {
    const result = parsed('Sugar brown), salt');
    expect(
      result.issues.some((issue) => issue.code === 'unbalanced_brackets'),
    ).toBe(true);
    expect(result.mentions.some((mention) => mention.name === 'salt')).toBe(
      true,
    );
  });

  it('does not invent a child from mismatched brackets', () => {
    const result = parsed('Flour (wheat], sugar');
    expect(result.mentions.some((mention) => mention.name === 'wheat')).toBe(
      false,
    );
    expect(result.mentions.some((mention) => mention.name === 'sugar')).toBe(
      true,
    );
    expect(
      result.issues.some((issue) => issue.code === 'unbalanced_brackets'),
    ).toBe(true);
    expect(
      result.mentions.find((mention) => mention.text.includes('wheat'))
        ?.issues[0]?.code,
    ).toBe('unbalanced_brackets');
  });

  it('still splits a balanced sibling after an earlier item', () => {
    const result = parsed('salt, Sugar (brown), pepper');
    const sugar = byName(result, 'Sugar');
    expect(byName(result, 'brown').parentId).toBe(sugar.id);
    expect(byName(result, 'pepper').parentId).toBeNull();
    expect(result.issues).toEqual([]);
  });

  it('does not merge contains with may-contain', () => {
    const input =
      'Wheat, milk. Contains: milk, soy. May contain traces of nuts';
    const result = parsed(input);
    const soy = byName(result, 'soy');
    const nuts = byName(result, 'nuts');
    expect(soy.role).toBe('allergen_contains');
    expect(nuts.role).toBe('allergen_may_contain');
    const soyParent = result.mentions.find(
      (mention) => mention.id === soy.parentId,
    );
    const nutsParent = result.mentions.find(
      (mention) => mention.id === nuts.parentId,
    );
    expect(soyParent?.role).toBe('allergen_contains');
    expect(nutsParent?.role).toBe('allergen_may_contain');
    expect(soyParent?.id).not.toBe(nutsParent?.id);
    const ingredientMilk = result.mentions.find(
      (mention) => mention.name === 'milk' && mention.role === 'ingredient',
    );
    const declaredMilk = result.mentions.find(
      (mention) =>
        mention.name === 'milk' && mention.role === 'allergen_contains',
    );
    expect(ingredientMilk?.id).not.toBe(declaredMilk?.id);
  });

  it('keeps the two statements apart when may-contain comes first', () => {
    const result = parsed('May contain nuts. Contains: milk');
    expect(byName(result, 'nuts').role).toBe('allergen_may_contain');
    expect(byName(result, 'milk').role).toBe('allergen_contains');
    expect(byName(result, 'nuts').parentId).not.toBe(
      byName(result, 'milk').parentId,
    );
  });

  it('labels a may-contain traces line on its own', () => {
    const result = parsed('May contain traces of nuts');
    const nuts = byName(result, 'nuts');
    const parent = result.mentions.find(
      (mention) => mention.id === nuts.parentId,
    );
    expect(parent?.name.toLowerCase()).toContain('may contain');
    expect(parent?.role).toBe('allergen_may_contain');
  });

  it('splits a contains line into separate allergen rows', () => {
    const result = parsed('Contains: milk, soy');
    expect(
      result.mentions
        .filter((mention) => mention.role === 'allergen_contains')
        .map((mention) => mention.name),
    ).toEqual(expect.arrayContaining(['Contains', 'milk', 'soy']));
    expect(
      result.mentions.some(
        (mention) => mention.role === 'allergen_may_contain',
      ),
    ).toBe(false);
  });

  it('does not treat "contains less than 2%" as an allergen statement', () => {
    const result = parsed('Contains less than 2% of: salt, yeast');
    expect(
      result.mentions.some((mention) => mention.role === 'allergen_contains'),
    ).toBe(false);
    expect(byName(result, 'salt').role).toBe('ingredient');
    expect(byName(result, 'yeast').role).toBe('ingredient');
  });

  it('reads a glued E number', () => {
    const [hit] = additives('E471');
    expect(hit?.scheme).toBe('e_number');
    expect(hit?.code).toBe('471');
    expect(hit?.written).toBe('E471');
  });

  it('reads an E number with a space', () => {
    const [hit] = additives('Emulsifier E 471');
    expect(hit?.code).toBe('471');
    expect(hit?.written).toBe('E 471');
  });

  it('reads an E number with a hyphen', () => {
    expect(additives('E-471')[0]?.code).toBe('471');
    expect(additives('E-471')[0]?.written).toBe('E-471');
  });

  it('keeps an en dash in the original E-number span', () => {
    const input = 'E\u2013471';
    const hit = additives(input)[0];
    expect(hit?.code).toBe('471');
    expect(hit?.written).toBe('E\u2013471');
    expect(input.slice(hit?.span.start, hit?.span.end)).toBe(input);
  });

  it('keeps the INS roman suffix exactly', () => {
    const hit = additives('INS 503(ii)')[0];
    expect(hit?.scheme).toBe('ins');
    expect(hit?.code).toBe('503(ii)');
    expect(hit?.suffix).toBe('(ii)');
    expect(hit?.written).toBe('INS 503(ii)');
    expect(hit?.code).not.toBe('503');
    expect(hit?.code).not.toBe('503(i)');
    const dotted = additives('I.N.S. 503(ii)')[0];
    expect(dotted?.scheme).toBe('ins');
    expect(dotted?.code).toBe('503(ii)');
    expect(dotted?.suffix).toBe('(ii)');
    expect(dotted?.written).toBe('I.N.S. 503(ii)');
  });

  it('does not collapse 503(ii) and 503(i) into one code', () => {
    expect(codes('Raising agents [503(i), 503(ii)]')).toEqual([
      '503(i)',
      '503(ii)',
    ]);
  });

  it('preserves an uppercase roman suffix', () => {
    const hit = additives('503(II)')[0];
    expect(hit?.suffix).toBe('(II)');
    expect(hit?.code).toBe('503(II)');
    expect(hit?.code).not.toBe('503(ii)');
  });

  it('reads a bare number inside an emulsifier class', () => {
    const result = parsed('Emulsifier (322)');
    expect(byName(result, 'Emulsifier').additiveClass).toBe('emulsifier');
    const hit = additives('Emulsifier (322)')[0];
    expect(hit?.scheme).toBe('class_context');
    expect(hit?.code).toBe('322');
    expect(hit?.suffix).toBeNull();
  });

  it('does not read a bare number outside an additive class', () => {
    expect(additives('322')).toEqual([]);
    expect(additives('sugar, 322, salt')).toEqual([]);
  });

  it('keeps the letter on INS 150d', () => {
    const hit = additives('Colour (INS 150d)')[0];
    expect(hit?.scheme).toBe('ins');
    expect(hit?.code).toBe('150d');
    expect(hit?.code).not.toBe('150');
    expect(byName(parsed('Colour (INS 150d)'), 'Colour').additiveClass).toBe(
      'colour',
    );
  });

  it('keeps the letter and the roman suffix on 160a(ii)', () => {
    const hit = additives('160a(ii)')[0];
    expect(hit?.scheme).toBe('printed_code');
    expect(hit?.code).toBe('160a(ii)');
    expect(hit?.suffix).toBe('(ii)');
    expect(hit?.code).not.toBe('160a(i)');
    expect(hit?.code).not.toBe('160');
  });

  it('keeps 160a(ii) distinct from 160a(i)', () => {
    expect(codes('Colours [160a(i), 160a(ii)]')).toEqual([
      '160a(i)',
      '160a(ii)',
    ]);
  });

  it('reads E 150d as an E number with its letter', () => {
    const hit = additives('Colour (E 150d)')[0];
    expect(hit?.scheme).toBe('e_number');
    expect(hit?.code).toBe('150d');
    expect(hit?.written).toBe('E 150d');
  });

  it('reads E160a(ii) without dropping the suffix', () => {
    const hit = additives('E160a(ii)')[0];
    expect(hit?.code).toBe('160a(ii)');
    expect(hit?.suffix).toBe('(ii)');
    expect(hit?.scheme).toBe('e_number');
  });

  it('does not turn a year into an additive', () => {
    expect(additives('Best before 2024, salt')).toEqual([]);
    expect(byName(parsed('Packed 2024, wheat'), 'wheat').role).toBe(
      'ingredient',
    );
  });

  it('does not turn a year inside an additive class into an additive', () => {
    expect(additives('Emulsifier (2024)')).toEqual([]);
    expect(byName(parsed('Emulsifier (2024)'), '2024').role).toBe('ingredient');
  });

  it('does not turn a weight into an additive', () => {
    expect(additives('Sugar, 500 g, salt')).toEqual([]);
    expect(additives('Net Qty 250ml, wheat')).toEqual([]);
  });

  it('does not turn a weight inside a raising-agent class into an additive', () => {
    expect(additives('Raising agents (500 g)')).toEqual([]);
    expect(additives('Raising agents (500)')[0]?.code).toBe('500');
  });

  it('does not turn 100% into an additive', () => {
    expect(additives('100%')).toEqual([]);
    expect(additives('Juice 100%')).toEqual([]);
  });

  it('does not turn an FSSAI licence number into an additive', () => {
    expect(additives('FSSAI Lic. No. 10012031000123, sugar')).toEqual([]);
  });

  it('does not turn a batch number into an additive', () => {
    expect(additives('Batch no. 4712, salt')).toEqual([]);
    expect(additives('Preservative batch 211')).toEqual([]);
  });

  it('still keeps an explicit INS code beside a batch word', () => {
    const hit = additives('Batch no. INS 503(ii)')[0];
    expect(hit?.code).toBe('503(ii)');
    expect(hit?.suffix).toBe('(ii)');
    expect(hit?.scheme).toBe('ins');
  });

  it('reads potassium benzoate context as INS 211', () => {
    expect(additives('Preservative (211)')[0]?.code).toBe('211');
    expect(
      additives('Acidity regulator (330, 331)').map((hit) => hit.code),
    ).toEqual(['330', '331']);
  });

  it('keeps a chemical name and a suffixed code as siblings', () => {
    const result = parsed('Raising agents [sodium bicarbonate and 500(ii)]');
    const parent = byName(result, 'Raising agents');
    const children = result.mentions.filter(
      (mention) => mention.parentId === parent.id,
    );
    expect(children.map((mention) => mention.name)).toEqual([
      'sodium bicarbonate',
      '500(ii)',
    ]);
    expect(children[0]?.additive).toBeNull();
    expect(children[1]?.additive?.suffix).toBe('(ii)');
  });

  it('does not treat preservative-free as an additive class', () => {
    expect(additives('preservative free (322)')).toEqual([]);
    expect(byName(parsed('preservative free (322)'), '322').role).toBe(
      'ingredient',
    );
  });

  it('accepts British and American stabiliser spellings', () => {
    expect(byName(parsed('Stabiliser (412)'), 'Stabiliser').additiveClass).toBe(
      'stabiliser',
    );
    expect(additives('Stabilizer (415)')[0]?.code).toBe('415');
  });

  it('keeps a non-breaking space inside the original span', () => {
    const input = 'Wheat\u00A0flour (63%)';
    const mention = byName(parsed(input), 'Wheat flour');
    expect(mention.text).toContain('\u00A0');
    expect(input.slice(mention.span.start, mention.span.end)).toBe(
      mention.text,
    );
    expect(mention.name).toBe('Wheat flour');
  });

  it('normalises curly quotes for the name and keeps them in the span', () => {
    const input = '\u201Csugar\u201D';
    const mention = parsed(input).mentions[0];
    expect(mention?.name).toBe('sugar');
    expect(mention?.text).toBe(input);
  });

  it('joins a hyphenated line break before matching the class', () => {
    const input = 'emulsi-\nfier (322)';
    const result = parsed(input);
    const parent = byName(result, 'emulsifier');
    expect(parent.additiveClass).toBe('emulsifier');
    expect(parent.text).toBe(input);
    expect(additives(input)[0]?.code).toBe('322');
  });

  it('joins a short lowercase fragment split by a line break', () => {
    const input = 'su\ngar, salt';
    const sugar = byName(parsed(input), 'sugar');
    expect(sugar.text).toBe('su\ngar');
    expect(names(input)).toContain('salt');
  });

  it('keeps a line break between whole words as a space', () => {
    const mention = parsed('Wheat\nflour').mentions[0];
    expect(mention?.name).toBe('Wheat flour');
    expect(mention?.text).toBe('Wheat\nflour');
  });

  it('does not glue a function word across a line break', () => {
    expect(parsed('in\nwater').mentions[0]?.name).toBe('in water');
  });

  it('splits on and, and/or, semicolon and a fullwidth comma', () => {
    expect(names('salt and pepper')).toEqual(['salt', 'pepper']);
    expect(names('salt and/or pepper')).toEqual(['salt', 'pepper']);
    expect(names('water; sugar; salt')).toEqual(['water', 'sugar', 'salt']);
    expect(names('sugar\uFF0Csalt')).toEqual(['sugar', 'salt']);
  });

  it('does not treat the ingredients label as a mention', () => {
    expect(names('Ingredients: wheat, sugar')).toEqual(['wheat', 'sugar']);
    expect(names('INGREDIENTS wheat, sugar')).toEqual(['wheat', 'sugar']);
  });

  it('drops a lone percentage and an empty panel', () => {
    expect(parsed('').mentions).toEqual([]);
    expect(parsed('   \n').mentions).toEqual([]);
    expect(parsed('63%').mentions).toEqual([]);
  });

  it('does not throw on broken brackets or repeated noise', () => {
    expect(() => parseIngredients('(((((')).not.toThrow();
    expect(() => parseIngredients(']})]and')).not.toThrow();
    const noise = '(((([{]})] and E471 503(ii) 2024 500 g %'.repeat(20);
    expect(() => parseIngredients(noise)).not.toThrow();
    expect(
      parsed('(((((').issues.some(
        (issue) => issue.code === 'unbalanced_brackets',
      ),
    ).toBe(true);
  });

  it('stops at the nesting limit without throwing', () => {
    let input = 'seed';
    for (let depth = 0; depth < 14; depth += 1) {
      input = `wrap${depth} (${input})`;
    }
    const result = parsed(input);
    expect(result.issues.some((issue) => issue.code === 'nesting_limit')).toBe(
      true,
    );
    expect(result.mentions.some((mention) => mention.name === 'seed')).toBe(
      false,
    );
  });

  it('stops at the mention limit without throwing', () => {
    const input = Array.from(
      { length: INGREDIENT_MENTION_LIMIT + 1 },
      () => 'salt',
    ).join(', ');
    const result = parsed(input);
    expect(result.mentions.length).toBeLessThanOrEqual(
      INGREDIENT_MENTION_LIMIT,
    );
    expect(result.issues.some((issue) => issue.code === 'mention_limit')).toBe(
      true,
    );
  });

  it('parses only the first panel-text limit and reports the tail', () => {
    const input = `${'salt, '.repeat(6000)}end`;
    expect(input.length).toBeGreaterThan(INGREDIENT_PANEL_TEXT_LIMIT);
    const result = parsed(input);
    expect(result.text).toBe(input);
    const issue = result.issues.find(
      (item) => item.code === 'panel_text_limit',
    );
    expect(issue?.action).toBe('retake');
    expect(issue?.span.start).toBeLessThan(input.length);
    expect(result.mentions.some((mention) => mention.name === 'end')).toBe(
      false,
    );
  });

  it('returns the same mentions for the same input', () => {
    const input =
      'Wheat flour (63%), emulsifier (E 471). Contains: milk. May contain nuts';
    expect(parsed(input)).toEqual(parsed(input));
  });

  it('maps unresolved names and leaves allergen rows out', () => {
    const input =
      'Wheat, milk. Contains: milk, soy. May contain traces of nuts';
    const result = parsed(input);
    const mapped = toIngredientMentions(result, {
      sourceIds: ['label-1'],
      taxonomyVersion: 'tax-test',
    });
    expect(mapped.mentions.map((mention) => mention.text)).toEqual([
      'Wheat',
      'milk',
    ]);
    expect(
      mapped.mentions.every((mention) => mention.state === 'unresolved'),
    ).toBe(true);
    expect(
      mapped.mentions.every((mention) => mention.canonicalId === null),
    ).toBe(true);
    expect(
      mapped.mentions.every((mention) => mention.candidateIds.length === 0),
    ).toBe(true);
    expect(
      mapped.mentions.every(
        (mention) => mention.taxonomyVersion === 'tax-test',
      ),
    ).toBe(true);
    expect(
      mapped.omitted.some((row) => row.reason === 'allergen_statement'),
    ).toBe(true);
    const ids = new Set(mapped.mentions.map((mention) => mention.id));
    for (const mention of mapped.mentions) {
      if (mention.parentId) {
        expect(ids.has(mention.parentId)).toBe(true);
      }
    }
  });

  it('keeps a roman suffix in the mapped mention text', () => {
    const mapped = toIngredientMentions(
      parsed('Raising agents [503(ii), 500(i)]'),
      {
        sourceIds: ['label-1'],
        taxonomyVersion: 'tax-test',
      },
    );
    expect(mapped.mentions.map((mention) => mention.text)).toEqual([
      'Raising agents',
      '503(ii)',
      '500(i)',
    ]);
    const parent = mapped.mentions[0];
    expect(mapped.mentions[1]?.parentId).toBe(parent?.id);
    expect(mapped.mentions[2]?.parentId).toBe(parent?.id);
  });

  it('maps bracket issues onto extraction issues without a span field', () => {
    const result = parsed('Sugar (brown');
    const issues = toExtractionIssues(result);
    expect(issues[0]?.code).toBe('unbalanced_brackets');
    expect(issues[0]?.stage).toBe('extraction');
    expect(issues[0]?.action).toBe('edit');
    expect(issues[0]?.field).toBe('ingredients');
    expect(issues[0]?.code).toMatch(/^[a-z][a-z0-9_.]{0,79}$/);
    expect(result.issues[0]?.span.end).toBeGreaterThan(
      result.issues[0]?.span.start ?? 0,
    );
  });

  it('rejects an empty map context', () => {
    const result = parsed('salt');
    expect(() =>
      toIngredientMentions(result, {
        sourceIds: [],
        taxonomyVersion: 'tax-test',
      }),
    ).toThrow(TypeError);
    expect(() =>
      toIngredientMentions(result, {
        sourceIds: ['label-1'],
        taxonomyVersion: '  ',
      }),
    ).toThrow(TypeError);
  });

  it('keeps original spans on a mixed adversarial panel', () => {
    const samples = [
      'Chocolate (sugar, cocoa mass (cocoa butter), milk)',
      'Raising agents [503(ii), 500(ii)]',
      'Flour {wheat, malted barley}',
      'Wheat flour (63%)',
      'Sugar 12.5 %',
      'Cocoa solids (min. 20%)',
      'salt, Sugar (brown',
      'Flour (wheat], sugar',
      'Wheat, milk. Contains: milk, soy. May contain traces of nuts',
      'E\u2013471, INS 503(ii), 160a(ii)',
      'Emulsifier (322), 322, Best before 2024, 500 g',
      'Wheat\u00A0flour (63%)',
      'emulsi-\nfier (322)',
      'su\ngar, salt',
      'Colour (INS 150d)',
      'Contains less than 2% of: salt, yeast',
      'preservative free (322)',
      'Raising agents (500 g)',
      'FSSAI Lic. No. 10012031000123',
      '((((',
    ];
    for (const sample of samples) {
      assertSpans(sample);
    }
  });
});
