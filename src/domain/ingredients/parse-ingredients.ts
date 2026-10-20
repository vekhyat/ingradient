import { findAdditives, type AdditiveHit } from './additives';
import { matchAdditiveClass } from './additive-classes';
import {
  INGREDIENT_MENTION_LIMIT,
  INGREDIENT_NESTING_LIMIT,
  INGREDIENT_PANEL_TEXT_LIMIT,
} from './limits';
import { prepareLabelText, spanFrom, type PreparedText } from './normalize';
import type {
  AdditiveIdentity,
  IngredientParseIssue,
  IngredientParseResult,
  IngredientRole,
  ParsedMention,
  ParsedPercentage,
  PercentageQualifier,
  TextSpan,
} from './types';

/**
 * Turns one ingredient panel into mentions.
 *
 * Separators are comma, semicolon and "and" (also "&" and "and/or").
 * Bracket groups nest. A group that does not balance stays one raw span:
 * sub-ingredients are not guessed. "Contains" and "May contain" stay
 * different roles and are never one list.
 *
 * FSSAI Labelling and Display Compendium, Version VIII (9 Sep 2025),
 * regs 5(2), 5(5) and 5(14); EU 1169/2011 arts 9 and 21 and Annex VII.
 * https://fssai.gov.in/upload/uploadfiles/files/Comp_Labelling%20Display_Version%20VIII_09_09_2025.pdf
 * https://eur-lex.europa.eu/eli/reg/2011/1169/oj
 */

interface Range {
  start: number;
  end: number;
}

interface HeaderMatch {
  kind: 'contains' | 'may_contain';
  phraseLength: number;
  skipLength: number;
  /** Lead-in such as "This product" is not its own mention. */
  omitWrapper?: boolean;
}

interface Section {
  kind: 'ingredients' | 'contains' | 'may_contain';
  headerStart: number | null;
  headerEnd: number | null;
  bodyStart: number;
  bodyEnd: number;
}

interface PercentHit {
  normStart: number;
  normEnd: number;
  value: number | null;
  qualifier: PercentageQualifier;
}

interface Ctx {
  full: string;
  prepared: PreparedText;
  text: string;
  mentions: ParsedMention[];
  issues: IngredientParseIssue[];
  nextId: number;
  stopped: boolean;
  limitNoted: boolean;
}

function isLetter(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\t';
}

function closerFor(open: string): string {
  if (open === '(') {
    return ')';
  }
  if (open === '[') {
    return ']';
  }
  if (open === '{') {
    return '}';
  }
  return '';
}

function trimRange(text: string, start: number, end: number): Range {
  let left = start;
  let right = end;
  while (left < right && isSpace(text.charAt(left))) {
    left += 1;
  }
  while (right > left && isSpace(text.charAt(right - 1))) {
    right -= 1;
  }
  return { start: left, end: right };
}

function trimItem(text: string, start: number, end: number): Range {
  let range = trimRange(text, start, end);
  if (text.charAt(range.end - 1) === '.') {
    range = trimRange(text, range.start, range.end - 1);
  }
  const marker = text.charAt(range.start);
  if (
    (marker === '•' || marker === '*' || marker === '-' || marker === '·') &&
    isSpace(text.charAt(range.start + 1))
  ) {
    range = trimRange(text, range.start + 1, range.end);
  }
  return range;
}

function canStartHeader(text: string, index: number): boolean {
  if (index <= 0) {
    return true;
  }
  const prev = text.charAt(index - 1);
  return !isLetter(prev) && !isDigit(prev);
}

function boundaryChar(text: string, index: number): string | null {
  let j = index - 1;
  while (j >= 0 && (text.charAt(j) === ' ' || text.charAt(j) === '\t')) {
    j -= 1;
  }
  if (j < 0) {
    return null;
  }
  return text.charAt(j);
}

function isStatementStart(text: string, index: number): boolean {
  const prev = boundaryChar(text, index);
  if (prev === null) {
    return true;
  }
  return prev === '\n' || prev === '.' || prev === ';';
}

function isLeadInBoundary(text: string, index: number): boolean {
  const prev = boundaryChar(text, index);
  return (
    prev === null ||
    prev === '\n' ||
    prev === '.' ||
    prev === ';' ||
    prev === ','
  );
}

function matchHeader(
  text: string,
  index: number,
  allowBareContains: boolean,
): HeaderMatch | null {
  const rest = text.slice(index);
  if (/^contains\s+less\s+than\b/i.test(rest)) {
    return null;
  }
  if (!canStartHeader(text, index)) {
    return null;
  }
  const productMay =
    /^((?:this\s+)?product\s+may\s+contain(?:\s+traces(?:\s+of)?)?)(\s*:?\s*)/i.exec(
      rest,
    );
  if (
    productMay?.[1] &&
    productMay[2] !== undefined &&
    isLeadInBoundary(text, index)
  ) {
    return {
      kind: 'may_contain',
      phraseLength: productMay[1].length,
      skipLength: productMay[1].length + productMay[2].length,
      omitWrapper: true,
    };
  }
  const may = /^(may\s+contain(?:\s+traces(?:\s+of)?)?)(\s*:?\s*)/i.exec(rest);
  if (may?.[1] && may[2] !== undefined) {
    return {
      kind: 'may_contain',
      phraseLength: may[1].length,
      skipLength: may[1].length + may[2].length,
    };
  }
  const withColon = /^(contains)(\s*:\s*)/i.exec(rest);
  if (withColon?.[1] && withColon[2] !== undefined) {
    return {
      kind: 'contains',
      phraseLength: withColon[1].length,
      skipLength: withColon[1].length + withColon[2].length,
    };
  }
  const bare = /^(contains)(\s+)/i.exec(rest);
  if (
    bare?.[1] &&
    bare[2] &&
    (allowBareContains || isStatementStart(text, index))
  ) {
    return {
      kind: 'contains',
      phraseLength: bare[1].length,
      skipLength: bare[1].length + bare[2].length,
    };
  }
  return null;
}

function skipIngredientsLabel(text: string): number {
  const match = /^(?:ingredient\s+list|ingredients?)\b\s*:?\s*/i.exec(text);
  if (!match?.[0]) {
    return 0;
  }
  return match[0].length;
}

const LESS_THAN =
  /^(contains\s+less\s+than\s+\d+(?:[.,]\d+)?\s*%\s+of)\s*:?\s*/i;

function isAndAt(text: string, index: number): boolean {
  const prev = text.charAt(index - 1);
  if (isLetter(prev) || isDigit(prev)) {
    return false;
  }
  const lower = text.slice(index, index + 6).toLowerCase();
  if (lower.startsWith('and/or')) {
    const after = text.charAt(index + 6);
    return !isLetter(after) && !isDigit(after);
  }
  if (lower.startsWith('and')) {
    const after = text.charAt(index + 3);
    return !isLetter(after) && !isDigit(after);
  }
  return false;
}

function separatorLength(text: string, index: number): number {
  if (isAndAt(text, index)) {
    return text
      .slice(index, index + 6)
      .toLowerCase()
      .startsWith('and/or')
      ? 6
      : 3;
  }
  return 1;
}

function isSeparatorAt(text: string, index: number): boolean {
  const ch = text.charAt(index);
  if (ch === ',') {
    return !(
      isDigit(text.charAt(index - 1)) && isDigit(text.charAt(index + 1))
    );
  }
  if (ch === ';' || ch === '&') {
    return true;
  }
  return isAndAt(text, index);
}

function readItem(
  text: string,
  start: number,
  end: number,
): { itemEnd: number; next: number; balanced: boolean } {
  const stack: string[] = [];
  let balanced = true;
  let i = start;
  while (i < end) {
    if (stack.length === 0 && isSeparatorAt(text, i)) {
      return { itemEnd: i, next: i + separatorLength(text, i), balanced };
    }
    const ch = text.charAt(i);
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack[stack.length - 1];
      if (top && closerFor(top) === ch) {
        stack.pop();
      } else {
        balanced = false;
        if (top) {
          stack.pop();
        }
      }
    }
    i += 1;
  }
  if (stack.length > 0) {
    balanced = false;
  }
  return { itemEnd: end, next: end, balanced };
}

function findTopGroups(
  text: string,
  start: number,
  end: number,
): { groups: Range[]; balanced: boolean } {
  const groups: Range[] = [];
  const stack: { open: string; pos: number }[] = [];
  let balanced = true;
  for (let i = start; i < end; i += 1) {
    const ch = text.charAt(i);
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push({ open: ch, pos: i });
      continue;
    }
    if (ch !== ')' && ch !== ']' && ch !== '}') {
      continue;
    }
    const top = stack[stack.length - 1];
    if (!top || closerFor(top.open) !== ch) {
      balanced = false;
      if (top) {
        stack.pop();
      }
      continue;
    }
    stack.pop();
    if (stack.length === 0) {
      groups.push({ start: top.pos, end: i + 1 });
    }
  }
  if (stack.length > 0) {
    balanced = false;
  }
  return { groups, balanced };
}

function qualifierOf(
  word: string | undefined,
  tilde: string | undefined,
  symbol: string | undefined,
): PercentageQualifier {
  if (tilde) {
    return 'approximate';
  }
  if (symbol) {
    const token = symbol.trim();
    if (token.startsWith('<') || token.startsWith('≤')) {
      return 'maximum';
    }
    if (token.startsWith('>') || token.startsWith('≥')) {
      return 'minimum';
    }
    return 'approximate';
  }
  if (!word) {
    return 'exact';
  }
  const lower = word.toLowerCase();
  if (lower.startsWith('min')) {
    return 'minimum';
  }
  if (lower.startsWith('max') || lower === 'less than') {
    return 'maximum';
  }
  if (lower === 'more than') {
    return 'minimum';
  }
  return 'approximate';
}

function parsePercentValue(raw: string): number | null {
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function findPercentages(
  text: string,
  start: number,
  end: number,
): PercentHit[] {
  const slice = text.slice(start, end);
  const re =
    /(?:(?:\b(less than|more than|minimum|min|maximum|max|approximately|approximate|approx|about)\.?\s*)|(~\s*)|((?:<=|>=|≤|≥|<|>)\s*))?(\d+(?:[.,]\d+)?)\s*%/gi;
  const found: PercentHit[] = [];
  for (const match of slice.matchAll(re)) {
    if (match.index === undefined || match[4] === undefined) {
      continue;
    }
    const normStart = start + match.index;
    found.push({
      normStart,
      normEnd: normStart + match[0].length,
      value: parsePercentValue(match[4]),
      qualifier: qualifierOf(match[1], match[2], match[3]),
    });
  }
  return found;
}

function isOnlyPercentage(text: string, start: number, end: number): boolean {
  const slice = text.slice(start, end).trim();
  return /^(?:(?:less than|more than|minimum|min|maximum|max|approximately|approximate|approx|about)\.?\s*|~\s*|(?:<=|>=|≤|≥|<|>)\s*)?\d+(?:[.,]\d+)?\s*%$/i.test(
    slice,
  );
}

/** `(ii)` is part of an additive code, not a nested ingredient. */
function isRomanSuffixGroup(text: string, group: Range): boolean {
  const inner = text.slice(group.start + 1, group.end - 1).trim();
  return /^[ivxlcdmIVXLCDM]+$/.test(inner);
}

/** Short code suffixes stay attached even when their identity is unsupported. */
function isCodeSuffixGroup(text: string, start: number, group: Range): boolean {
  const inner = text.slice(group.start + 1, group.end - 1).trim();
  if (!/^[a-z0-9]{1,2}$/i.test(inner)) {
    return false;
  }
  return /(?:^|[^a-z0-9])(?:(?:e|i\.?\s*n\.?\s*s\.?)[\s.\-]*)?\d{3,4}[a-f]?(?:\s*(?:\(\s*[a-z0-9]+\s*\)|\[\s*[a-z0-9]+\s*\]|\{\s*[a-z0-9]+\s*\}))*\s*$/i.test(
    text.slice(start, group.start),
  );
}

function classColonIntroduces(
  text: string,
  start: number,
  end: number,
): boolean {
  const raw = text.slice(start, end);
  const colon = raw.indexOf(':');
  if (colon <= 0) {
    return false;
  }
  return matchAdditiveClass(raw.slice(0, colon)) !== null;
}

function isBareClassCode(text: string, start: number, end: number): boolean {
  const slice = text
    .slice(start, end)
    .trim()
    .replace(/[.;]+$/g, '');
  return /^(?:[eE][\s.-]*)?(?:I\.?\s*N\.?\s*S\.?[\s.-]*)?\d{3,4}(?:[a-fA-F])?(?:\s*\((?:[ivxlcdmIVXLCDM]+|[a-fA-F])\))?$/.test(
    slice,
  );
}

function coverRanges(start: number, end: number, holes: Range[]): Range[] {
  const merged: Range[] = [];
  const sorted = holes
    .map((hole) => ({
      start: Math.max(start, hole.start),
      end: Math.min(end, hole.end),
    }))
    .filter((hole) => hole.end > hole.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (const hole of sorted) {
    const last = merged[merged.length - 1];
    if (last && hole.start <= last.end) {
      last.end = Math.max(last.end, hole.end);
    } else {
      merged.push({ start: hole.start, end: hole.end });
    }
  }
  const parts: Range[] = [];
  let cursor = start;
  for (const hole of merged) {
    if (hole.start > cursor) {
      parts.push({ start: cursor, end: hole.start });
    }
    cursor = Math.max(cursor, hole.end);
  }
  if (cursor < end) {
    parts.push({ start: cursor, end });
  }
  return parts;
}

function cleanPart(part: string): string {
  let value = part.replace(/\s+/g, ' ').trim();
  while (value.startsWith('"') || value.startsWith("'")) {
    value = value.slice(1).trim();
  }
  while (value.endsWith('"') || value.endsWith("'")) {
    value = value.slice(0, -1).trim();
  }
  return value.replace(/[.,;:]+$/g, '').trim();
}

function roleOf(kind: 'contains' | 'may_contain'): IngredientRole {
  return kind === 'contains' ? 'allergen_contains' : 'allergen_may_contain';
}

function kindOf(
  role: IngredientRole,
): 'ingredients' | 'contains' | 'may_contain' {
  if (role === 'allergen_contains') {
    return 'contains';
  }
  if (role === 'allergen_may_contain') {
    return 'may_contain';
  }
  return 'ingredients';
}

function clipLength(input: string): number {
  if (input.length <= INGREDIENT_PANEL_TEXT_LIMIT) {
    return input.length;
  }
  const end = INGREDIENT_PANEL_TEXT_LIMIT;
  const code = input.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    return end - 1;
  }
  return end;
}

function makeIssue(
  code: IngredientParseIssue['code'],
  message: string,
  span: TextSpan,
  action: IngredientParseIssue['action'],
): IngredientParseIssue {
  return { code, message, span, action };
}

function noteLimit(ctx: Ctx, fromNorm: number, toNorm: number): void {
  if (ctx.limitNoted) {
    ctx.stopped = true;
    return;
  }
  ctx.limitNoted = true;
  ctx.stopped = true;
  const span = spanFrom(ctx.prepared, fromNorm, Math.max(fromNorm, toNorm));
  ctx.issues.push(
    makeIssue(
      'mention_limit',
      `Only the first ${INGREDIENT_MENTION_LIMIT} ingredient mentions were kept.`,
      span.start === span.end
        ? { start: span.start, end: ctx.full.length }
        : span,
      'edit',
    ),
  );
}

function sliceAt(
  ctx: Ctx,
  start: number,
  end: number,
): { text: string; span: TextSpan } {
  const span = spanFrom(ctx.prepared, start, end);
  return { text: ctx.full.slice(span.start, span.end), span };
}

function toPercentage(ctx: Ctx, hit: PercentHit): ParsedPercentage {
  const sliced = sliceAt(ctx, hit.normStart, hit.normEnd);
  return {
    text: sliced.text,
    span: sliced.span,
    value: hit.value,
    qualifier: hit.qualifier,
  };
}

function toAdditive(ctx: Ctx, hit: AdditiveHit): AdditiveIdentity {
  const sliced = sliceAt(ctx, hit.normStart, hit.normEnd);
  return {
    code: hit.code,
    written: sliced.text,
    span: sliced.span,
    scheme: hit.scheme,
    suffix: hit.suffix,
  };
}

function splitSections(text: string): Section[] {
  const sections: Section[] = [];
  let kind: Section['kind'] = 'ingredients';
  let headerStart: number | null = null;
  let headerEnd: number | null = null;
  let bodyStart = skipIngredientsLabel(text);
  const stack: string[] = [];
  let i = bodyStart;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
      i += 1;
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      const top = stack[stack.length - 1];
      if (top && closerFor(top) === ch) {
        stack.pop();
      } else if (top) {
        stack.pop();
      }
      i += 1;
      continue;
    }
    if (stack.length === 0) {
      const header = matchHeader(text, i, false);
      if (
        header &&
        header.skipLength > 0 &&
        (i > bodyStart || (i === bodyStart && headerStart === null))
      ) {
        if (i > bodyStart) {
          sections.push({
            kind,
            headerStart,
            headerEnd,
            bodyStart,
            bodyEnd: i,
          });
        }
        kind = header.kind;
        headerStart = header.omitWrapper ? null : i;
        headerEnd = header.omitWrapper ? null : i + header.phraseLength;
        bodyStart = i + header.skipLength;
        i = bodyStart;
        continue;
      }
    }
    i += 1;
  }
  sections.push({
    kind,
    headerStart,
    headerEnd,
    bodyStart,
    bodyEnd: text.length,
  });
  return sections.filter((section) => {
    if (section.kind !== 'ingredients' || section.headerStart !== null) {
      return true;
    }
    const trimmed = trimRange(text, section.bodyStart, section.bodyEnd);
    return trimmed.start < trimmed.end;
  });
}

function appendStatement(
  ctx: Ctx,
  headerStart: number,
  headerEnd: number,
  bodyStart: number,
  bodyEnd: number,
  parentId: string | null,
  kind: 'contains' | 'may_contain',
  depth: number,
): void {
  if (ctx.mentions.length >= INGREDIENT_MENTION_LIMIT) {
    noteLimit(ctx, headerStart, bodyEnd);
    return;
  }
  if (depth >= INGREDIENT_NESTING_LIMIT) {
    appendLimitedSpan(ctx, headerStart, bodyEnd, parentId, roleOf(kind), depth);
    return;
  }
  const id = `m${ctx.nextId}`;
  ctx.nextId += 1;
  const body = trimRange(ctx.text, bodyStart, bodyEnd);
  const end = Math.max(headerEnd, body.end);
  const sliced = sliceAt(ctx, headerStart, end);
  const name = cleanPart(ctx.text.slice(headerStart, headerEnd));
  const nameSlice = sliceAt(ctx, headerStart, headerEnd);
  ctx.mentions.push({
    id,
    role: roleOf(kind),
    parentId,
    text: sliced.text,
    span: sliced.span,
    name,
    nameSpans: name.length > 0 ? [nameSlice.span] : [],
    percentage: null,
    additive: null,
    additiveClass: null,
    depth,
    issues: [],
  });
  appendList(ctx, body.start, body.end, id, roleOf(kind), false, depth + 1);
}

function appendList(
  ctx: Ctx,
  start: number,
  end: number,
  parentId: string | null,
  role: IngredientRole,
  classContext: boolean,
  depth: number,
): void {
  let i = start;
  let followClass = classContext;
  while (i < end && !ctx.stopped) {
    while (i < end && isSpace(ctx.text.charAt(i))) {
      i += 1;
    }
    const marker = ctx.text.charAt(i);
    if (
      (marker === '•' || marker === '*' || marker === '·' || marker === '-') &&
      isSpace(ctx.text.charAt(i + 1))
    ) {
      i += 1;
      continue;
    }
    if (i >= end) {
      return;
    }
    const header = matchHeader(ctx.text, i, true);
    if (header && header.skipLength > 0 && header.kind !== kindOf(role)) {
      appendStatement(
        ctx,
        i,
        i + header.phraseLength,
        i + header.skipLength,
        end,
        parentId,
        header.kind,
        depth,
      );
      return;
    }
    const read = readItem(ctx.text, i, end);
    const item = trimItem(ctx.text, i, read.itemEnd);
    if (item.start < item.end) {
      const opensClass = classColonIntroduces(ctx.text, item.start, item.end);
      const bareCode = isBareClassCode(ctx.text, item.start, item.end);
      const useClass = classContext || opensClass || (followClass && bareCode);
      appendItem(
        ctx,
        item.start,
        item.end,
        parentId,
        role,
        useClass,
        depth,
        read.balanced,
      );
      if (!classContext) {
        followClass = opensClass || (followClass && bareCode);
      }
    }
    if (read.next <= i) {
      i += 1;
      continue;
    }
    i = read.next;
  }
}

function nameFrom(
  text: string,
  parts: Range[],
): { name: string; spans: Range[] } {
  const spans: Range[] = [];
  const words: string[] = [];
  for (const part of parts) {
    const trimmed = trimRange(text, part.start, part.end);
    const word = cleanPart(text.slice(trimmed.start, trimmed.end));
    if (word.length === 0 || trimmed.start >= trimmed.end) {
      continue;
    }
    words.push(word);
    spans.push(trimmed);
  }
  return { name: words.join(' '), spans };
}

function choosePercent(
  text: string,
  percentGroups: Range[],
  outside: Range[],
): PercentHit | null {
  let chosen: PercentHit | null = null;
  for (const group of percentGroups) {
    const hits = findPercentages(text, group.start, group.end);
    const last = hits[hits.length - 1];
    if (last) {
      chosen = last;
    }
  }
  if (chosen) {
    return chosen;
  }
  for (const part of outside) {
    const hits = findPercentages(text, part.start, part.end);
    const last = hits[hits.length - 1];
    if (last) {
      chosen = last;
    }
  }
  return chosen;
}

/** Keep an unexpanded subtree opaque instead of guessing names inside it. */
function appendLimitedSpan(
  ctx: Ctx,
  start: number,
  end: number,
  parentId: string | null,
  role: IngredientRole,
  depth: number,
): void {
  const sliced = sliceAt(ctx, start, end);
  const issue = makeIssue(
    'nesting_limit',
    `Nesting deeper than ${INGREDIENT_NESTING_LIMIT} was kept as one span.`,
    sliced.span,
    'edit',
  );
  ctx.mentions.push({
    id: `m${ctx.nextId}`,
    role,
    parentId,
    text: sliced.text,
    span: sliced.span,
    name: cleanPart(ctx.text.slice(start, end)),
    nameSpans: [sliced.span],
    percentage: null,
    additive: null,
    additiveClass: null,
    depth,
    issues: [issue],
  });
  ctx.nextId += 1;
  ctx.issues.push(issue);
}

function appendItem(
  ctx: Ctx,
  start: number,
  end: number,
  parentId: string | null,
  role: IngredientRole,
  classContext: boolean,
  depth: number,
  balancedFlag: boolean,
): void {
  if (ctx.stopped) {
    return;
  }
  if (ctx.mentions.length >= INGREDIENT_MENTION_LIMIT) {
    noteLimit(ctx, start, end);
    return;
  }
  const less = LESS_THAN.exec(ctx.text.slice(start, end));
  let itemStart = start;
  if (less?.[0]) {
    itemStart = trimRange(ctx.text, start + less[0].length, end).start;
  }
  const item = trimItem(ctx.text, itemStart, end);
  if (item.start >= item.end) {
    return;
  }

  const structure = balancedFlag
    ? findTopGroups(ctx.text, item.start, item.end)
    : { groups: [], balanced: false };
  const structureOk = balancedFlag && structure.balanced;
  const percentGroups: Range[] = [];
  const childGroups: Range[] = [];
  if (structureOk) {
    for (const group of structure.groups) {
      const inner = trimRange(ctx.text, group.start + 1, group.end - 1);
      if (isOnlyPercentage(ctx.text, inner.start, inner.end)) {
        percentGroups.push(group);
      } else if (
        !isRomanSuffixGroup(ctx.text, group) &&
        !isCodeSuffixGroup(ctx.text, item.start, group)
      ) {
        childGroups.push(group);
      }
    }
  }

  if (childGroups.length > 0 && depth >= INGREDIENT_NESTING_LIMIT) {
    appendLimitedSpan(ctx, item.start, item.end, parentId, role, depth);
    return;
  }

  const groupHoles = structureOk ? [...percentGroups, ...childGroups] : [];
  const outside = coverRanges(item.start, item.end, groupHoles);
  const percentHit = choosePercent(
    ctx.text,
    percentGroups,
    structureOk ? outside : [{ start: item.start, end: item.end }],
  );
  const percentHoles =
    percentHit && percentGroups.length === 0
      ? [{ start: percentHit.normStart, end: percentHit.normEnd }]
      : [];
  const nameParts = nameFrom(
    ctx.text,
    coverRanges(item.start, item.end, [...groupHoles, ...percentHoles]),
  );
  let name = nameParts.name;
  const expandChildren =
    structureOk && childGroups.length > 0 && depth < INGREDIENT_NESTING_LIMIT;
  if (name.length === 0 && !structureOk) {
    name = cleanPart(ctx.text.slice(item.start, item.end));
  }
  if (name.length === 0 && expandChildren) {
    const ownClass = classContext;
    for (const group of childGroups) {
      appendList(
        ctx,
        group.start + 1,
        group.end - 1,
        parentId,
        role,
        ownClass,
        depth + 1,
      );
    }
    return;
  }
  if (name.length === 0) {
    return;
  }

  const additiveClass = matchAdditiveClass(name);
  const searchContext = classContext || additiveClass !== null;
  const searchParts =
    nameParts.spans.length > 0
      ? nameParts.spans
      : [{ start: item.start, end: item.end }];
  const hits: AdditiveHit[] = [];
  for (const part of searchParts) {
    hits.push(...findAdditives(ctx.text, part.start, part.end, searchContext));
  }

  const issues: IngredientParseIssue[] = [];
  if (!structureOk && !balancedFlag) {
    const sliced = sliceAt(ctx, item.start, item.end);
    issues.push(
      makeIssue(
        'unbalanced_brackets',
        'Brackets do not balance. The original text is kept as one span and sub-ingredients were not guessed.',
        sliced.span,
        'edit',
      ),
    );
  }

  const synthetic = hits.length > 1 && !expandChildren;
  if (synthetic && depth >= INGREDIENT_NESTING_LIMIT) {
    appendLimitedSpan(ctx, item.start, item.end, parentId, role, depth);
    return;
  }
  const id = `m${ctx.nextId}`;
  ctx.nextId += 1;
  const sliced = sliceAt(ctx, item.start, item.end);
  const additive =
    hits.length === 1 && hits[0] ? toAdditive(ctx, hits[0]) : null;
  let roleOut = role;
  if (additive && roleOut === 'ingredient') {
    roleOut = 'additive';
  }
  const mention: ParsedMention = {
    id,
    role: roleOut,
    parentId,
    text: sliced.text,
    span: sliced.span,
    name,
    nameSpans: nameParts.spans.map(
      (part) => sliceAt(ctx, part.start, part.end).span,
    ),
    percentage: percentHit ? toPercentage(ctx, percentHit) : null,
    additive,
    additiveClass,
    depth,
    issues,
  };
  ctx.mentions.push(mention);
  ctx.issues.push(...issues);

  if (synthetic) {
    for (const hit of hits) {
      appendSyntheticAdditive(ctx, hit, id, role, depth + 1);
    }
    return;
  }
  if (!expandChildren) {
    return;
  }
  const childContext = searchContext;
  const childRole =
    role === 'ingredient' || role === 'additive' ? 'ingredient' : role;
  for (const group of childGroups) {
    appendList(
      ctx,
      group.start + 1,
      group.end - 1,
      id,
      childRole,
      childContext,
      depth + 1,
    );
  }
}

function appendSyntheticAdditive(
  ctx: Ctx,
  hit: AdditiveHit,
  parentId: string,
  role: IngredientRole,
  depth: number,
): void {
  if (ctx.mentions.length >= INGREDIENT_MENTION_LIMIT) {
    noteLimit(ctx, hit.normStart, hit.normEnd);
    return;
  }
  const sliced = sliceAt(ctx, hit.normStart, hit.normEnd);
  const name = cleanPart(ctx.text.slice(hit.normStart, hit.normEnd));
  if (name.length === 0) {
    return;
  }
  ctx.mentions.push({
    id: `m${ctx.nextId}`,
    role:
      role === 'allergen_contains' || role === 'allergen_may_contain'
        ? role
        : 'additive',
    parentId,
    text: sliced.text,
    span: sliced.span,
    name,
    nameSpans: [sliced.span],
    percentage: null,
    additive: toAdditive(ctx, hit),
    additiveClass: null,
    depth,
    issues: [],
  });
  ctx.nextId += 1;
}

function parsePrepared(
  full: string,
  prepared: PreparedText,
): IngredientParseResult {
  const ctx: Ctx = {
    full,
    prepared,
    text: prepared.normalized,
    mentions: [],
    issues: [],
    nextId: 1,
    stopped: false,
    limitNoted: false,
  };
  for (const section of splitSections(prepared.normalized)) {
    if (ctx.stopped) {
      break;
    }
    if (section.kind === 'ingredients') {
      appendList(
        ctx,
        section.bodyStart,
        section.bodyEnd,
        null,
        'ingredient',
        false,
        1,
      );
      continue;
    }
    if (section.headerStart === null || section.headerEnd === null) {
      appendList(
        ctx,
        section.bodyStart,
        section.bodyEnd,
        null,
        roleOf(section.kind),
        false,
        1,
      );
      continue;
    }
    appendStatement(
      ctx,
      section.headerStart,
      section.headerEnd,
      section.bodyStart,
      section.bodyEnd,
      null,
      section.kind,
      1,
    );
  }
  return { text: full, mentions: ctx.mentions, issues: ctx.issues };
}

function failed(input: string): IngredientParseResult {
  const issue = makeIssue(
    'parse_failure',
    'The ingredient text could not be parsed. The original text is unchanged.',
    { start: 0, end: input.length },
    'edit',
  );
  const trimmed = input.trim();
  const mentions: ParsedMention[] = [];
  if (trimmed.length > 0) {
    mentions.push({
      id: 'm1',
      role: 'ingredient',
      parentId: null,
      text: input,
      span: { start: 0, end: input.length },
      name: trimmed.replace(/\s+/g, ' '),
      nameSpans: [{ start: 0, end: input.length }],
      percentage: null,
      additive: null,
      additiveClass: null,
      depth: 1,
      issues: [issue],
    });
  }
  return { text: input, mentions, issues: [issue] };
}

export function parseIngredients(input: string): IngredientParseResult {
  try {
    const end = clipLength(input);
    const issues: IngredientParseIssue[] = [];
    if (end < input.length) {
      issues.push(
        makeIssue(
          'panel_text_limit',
          `Ingredient text is longer than ${INGREDIENT_PANEL_TEXT_LIMIT} characters. Only the first ${INGREDIENT_PANEL_TEXT_LIMIT} were parsed.`,
          { start: end, end: input.length },
          'retake',
        ),
      );
    }
    const prepared = prepareLabelText(input.slice(0, end));
    const parsed = parsePrepared(input, prepared);
    return { ...parsed, issues: [...issues, ...parsed.issues] };
  } catch {
    return failed(input);
  }
}
