import { parseAmountCell } from './amount';
import type { NutritionBoundingBox, NutritionTextFragment } from './ocr-input';
import {
  parseCaption,
  parseHeader,
  type Basis,
  type ServingSize,
} from './vocabulary';

export interface PlacedFragment {
  id: string;
  text: string;
  box: NutritionBoundingBox;
  lineId?: string;
  blockId?: string;
}

export interface TableWarning {
  code: string;
  message: string;
}

export interface NutritionColumn {
  basis: Basis | null;
  reference: boolean;
  incompleteBasis: boolean;
  serving: ServingSize | null;
  center: number;
  halfGap: number;
}

export interface PlacedAmount {
  column: number | 'ambiguous';
  fragment: PlacedFragment;
}

export interface NutritionDataRow {
  label: string;
  labelIds: string[];
  amounts: PlacedAmount[];
}

export interface TableModel {
  columns: NutritionColumn[];
  rows: NutritionDataRow[];
  warnings: TableWarning[];
}

interface RawRow {
  label: string;
  labelIds: string[];
  amounts: PlacedFragment[];
}

/**
 * Rows come from box overlap, or from a shared `lineId`. `blockId` is ignored:
 * one engine block is often the entire table.
 *
 * Without a header, amount centres more than 28 units apart are different
 * columns. A caption such as "Typical values per 100 g" supplies the basis
 * only when that clustering finds one column.
 */
export function buildTableModel(
  fragments: readonly PlacedFragment[],
): TableModel {
  const warnings: TableWarning[] = [];
  const visualRows = clusterRows(fragments);
  let cursor = 0;
  let caption = singleCellCaption(visualRows[0]);
  if (caption !== null) {
    cursor = 1;
  }

  const headerRows: PlacedFragment[][] = [];
  while (cursor < visualRows.length) {
    const row = visualRows[cursor];
    if (row === undefined || !isHeaderRow(row)) {
      break;
    }
    headerRows.push(row);
    cursor += 1;
  }

  let columns = columnsFromHeaders(headerRows);
  const rawRows: RawRow[] = [];
  for (let index = cursor; index < visualRows.length; index += 1) {
    const row = visualRows[index];
    if (row === undefined) {
      continue;
    }
    const raw = splitDataRow(row, warnings);
    if (raw === null) {
      continue;
    }
    if (raw.label.length === 0) {
      const previous = rawRows[rawRows.length - 1];
      if (previous === undefined) {
        warnings.push({
          code: 'unlabelled_amount',
          message:
            'An amount has no nutrient name on its row or on the row above.',
        });
        continue;
      }
      previous.amounts.push(...raw.amounts);
      continue;
    }
    rawRows.push(raw);
  }

  if (columns.length === 0) {
    columns = columnsFromAmounts(rawRows, caption);
  }

  return {
    columns,
    rows: rawRows.map((row) => ({
      label: row.label,
      labelIds: row.labelIds,
      amounts: row.amounts.map((fragment) => ({
        fragment,
        column: assignColumn(fragment, columns),
      })),
    })),
    warnings,
  };
}

export function fragmentFromInput(
  fragment: NutritionTextFragment,
  id: string,
): PlacedFragment | null {
  const { box } = fragment;
  if (
    !Number.isFinite(box.x) ||
    !Number.isFinite(box.y) ||
    !Number.isFinite(box.width) ||
    !Number.isFinite(box.height) ||
    box.width <= 0 ||
    box.height <= 0
  ) {
    return null;
  }
  return {
    id,
    text: fragment.text,
    box,
    ...(fragment.lineId === undefined ? {} : { lineId: fragment.lineId }),
    ...(fragment.blockId === undefined ? {} : { blockId: fragment.blockId }),
  };
}

function clusterRows(fragments: readonly PlacedFragment[]): PlacedFragment[][] {
  const sorted = [...fragments].sort(
    (left, right) =>
      centerY(left.box) - centerY(right.box) || left.box.x - right.box.x,
  );
  const rows: PlacedFragment[][] = [];
  for (const fragment of sorted) {
    let matched: PlacedFragment[] | undefined;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row === undefined) {
        continue;
      }
      if (belongsToRow(fragment, row)) {
        matched = row;
        break;
      }
      const bottom = Math.max(
        ...row.map((item) => item.box.y + item.box.height),
      );
      if (fragment.box.y > bottom + fragment.box.height) {
        break;
      }
    }
    if (matched === undefined) {
      rows.push([fragment]);
    } else {
      matched.push(fragment);
    }
  }
  for (const row of rows) {
    row.sort((left, right) => left.box.x - right.box.x);
  }
  return rows;
}

function belongsToRow(
  fragment: PlacedFragment,
  row: readonly PlacedFragment[],
): boolean {
  return row.some(
    (other) =>
      (fragment.lineId !== undefined && fragment.lineId === other.lineId) ||
      sameBand(fragment.box, other.box),
  );
}

function sameBand(
  left: NutritionBoundingBox,
  right: NutritionBoundingBox,
): boolean {
  const overlap =
    Math.min(left.y + left.height, right.y + right.height) -
    Math.max(left.y, right.y);
  const minHeight = Math.min(left.height, right.height);
  if (minHeight > 0 && overlap / minHeight >= 0.5) {
    return true;
  }
  return (
    Math.abs(centerY(left) - centerY(right)) <=
    0.45 * Math.max(left.height, right.height)
  );
}

function centerY(box: NutritionBoundingBox): number {
  return box.y + box.height / 2;
}

function singleCellCaption(
  row: readonly PlacedFragment[] | undefined,
): Basis | 'incomplete' | null {
  if (row === undefined || row.length !== 1) {
    return null;
  }
  const only = row[0];
  if (only === undefined) {
    return null;
  }
  return parseCaption(only.text);
}

function isHeaderRow(row: readonly PlacedFragment[]): boolean {
  let headers = 0;
  let data = 0;
  for (const cell of row) {
    if (parseHeader(cell.text) !== null) {
      headers += 1;
      continue;
    }
    if (isDataAmount(cell.text)) {
      data += 1;
    }
  }
  return headers > 0 && data === 0;
}

function isDataAmount(text: string): boolean {
  if (parseHeader(text) !== null) {
    return false;
  }
  const parsed = parseAmountCell(text);
  return parsed.status !== 'unreadable' && parsed.status !== 'empty';
}

function columnsFromHeaders(
  headerRows: readonly (readonly PlacedFragment[])[],
): NutritionColumn[] {
  const draft: NutritionColumn[] = [];
  const servingMarks: { center: number; serving: ServingSize }[] = [];
  for (const row of headerRows) {
    for (const cell of row) {
      const header = parseHeader(cell.text);
      if (header === null || header.kind === 'label_header') {
        continue;
      }
      const center = cell.box.x + cell.box.width / 2;
      if (header.kind === 'serving_size') {
        servingMarks.push({ center, serving: header.serving });
        continue;
      }
      if (header.kind === 'reference') {
        draft.push(bareColumn(center, { reference: true }));
        continue;
      }
      if (header.kind === 'incomplete_basis') {
        draft.push(bareColumn(center, { incompleteBasis: true }));
        continue;
      }
      draft.push({
        basis: header.basis,
        reference: false,
        incompleteBasis: false,
        serving: header.serving,
        center,
        halfGap: 0,
      });
    }
  }
  for (const mark of servingMarks) {
    const column = nearestColumn(draft, mark.center);
    if (column !== undefined && column.serving === null) {
      column.serving = mark.serving;
    }
  }
  return withHalfGaps(draft);
}

function columnsFromAmounts(
  rows: readonly RawRow[],
  caption: Basis | 'incomplete' | null,
): NutritionColumn[] {
  const centers = rows.flatMap((row) =>
    row.amounts.map((amount) => amount.box.x + amount.box.width / 2),
  );
  const clustered = clusterCenters(centers);
  const basis =
    clustered.length === 1 && caption !== null && caption !== 'incomplete'
      ? caption
      : null;
  return withHalfGaps(
    clustered.map((center) =>
      bareColumn(center, {
        basis,
        incompleteBasis: basis === null,
      }),
    ),
  );
}

function bareColumn(
  center: number,
  flags: {
    reference?: boolean;
    incompleteBasis?: boolean;
    basis?: Basis | null;
  },
): NutritionColumn {
  return {
    basis: flags.basis ?? null,
    reference: flags.reference ?? false,
    incompleteBasis: flags.incompleteBasis ?? false,
    serving: null,
    center,
    halfGap: 0,
  };
}

function clusterCenters(centers: readonly number[]): number[] {
  const sorted = [...centers].sort((left, right) => left - right);
  const groups: number[][] = [];
  for (const center of sorted) {
    const current = groups[groups.length - 1];
    const last = current?.[current.length - 1];
    if (current === undefined || last === undefined || center - last > 28) {
      groups.push([center]);
    } else {
      current.push(center);
    }
  }
  return groups.map(
    (group) => group.reduce((sum, value) => sum + value, 0) / group.length,
  );
}

function withHalfGaps(columns: readonly NutritionColumn[]): NutritionColumn[] {
  const sorted = [...columns].sort((left, right) => left.center - right.center);
  return sorted.map((column, index) => {
    const previous = sorted[index - 1];
    const next = sorted[index + 1];
    const leftGap =
      previous === undefined
        ? next === undefined
          ? 80
          : (next.center - column.center) / 2
        : (column.center - previous.center) / 2;
    const rightGap =
      next === undefined ? leftGap : (next.center - column.center) / 2;
    return { ...column, halfGap: Math.min(leftGap, rightGap) };
  });
}

function splitDataRow(
  row: readonly PlacedFragment[],
  warnings: TableWarning[],
): RawRow | null {
  const labels: PlacedFragment[] = [];
  const amounts: PlacedFragment[] = [];
  for (const cell of row) {
    const header = parseHeader(cell.text);
    if (header !== null && header.kind !== 'label_header') {
      warnings.push({
        code: 'stray_header',
        message: `A header (“${cell.text.trim()}”) sits on a nutrient row and was not read as an amount.`,
      });
      continue;
    }
    if (isDataAmount(cell.text)) {
      amounts.push(cell);
    } else if (cell.text.trim().length > 0) {
      labels.push(cell);
    }
  }
  if (labels.length === 0 && amounts.length === 0) {
    return null;
  }
  return {
    label: labels
      .map((label) => label.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
    labelIds: labels.map((label) => label.id),
    amounts,
  };
}

function assignColumn(
  fragment: PlacedFragment,
  columns: readonly NutritionColumn[],
): number | 'ambiguous' {
  if (columns.length === 0) {
    return 'ambiguous';
  }
  const center = fragment.box.x + fragment.box.width / 2;
  const spanned = columns.filter(
    (column) =>
      column.center >= fragment.box.x &&
      column.center <= fragment.box.x + fragment.box.width,
  );
  if (spanned.length >= 2) {
    return 'ambiguous';
  }
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  columns.forEach((column, index) => {
    const distance = Math.abs(center - column.center);
    if (distance < bestDistance) {
      second = bestDistance;
      bestDistance = distance;
      best = index;
    } else if (distance < second) {
      second = distance;
    }
  });
  if (Number.isFinite(second) && second - bestDistance <= 12) {
    return 'ambiguous';
  }
  const chosen = columns[best];
  if (chosen === undefined) {
    return 'ambiguous';
  }
  if (
    bestDistance > Math.max(chosen.halfGap * 1.2, 48) &&
    spanned.length === 0
  ) {
    return 'ambiguous';
  }
  return best;
}

function nearestColumn(
  columns: readonly NutritionColumn[],
  center: number,
): NutritionColumn | undefined {
  let best: NutritionColumn | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const column of columns) {
    const distance = Math.abs(column.center - center);
    if (distance < bestDistance) {
      best = column;
      bestDistance = distance;
    }
  }
  return best;
}
