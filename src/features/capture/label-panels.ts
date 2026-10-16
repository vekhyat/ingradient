import type { NutritionTextFragment } from '../../domain/nutrition';
import type { OcrBlock, OcrPage } from './ocr-page';

/**
 * Splits one photo's text into the two label panels the app reads:
 * the ingredient list and the nutrition table. One photo can hold both
 * (D57); a photo holding neither yields neither and invents nothing.
 *
 * This is a reading-order heuristic over OCR blocks, not a layout model:
 * - Ingredients start at a line that says "Ingredients" and continue through
 *   following blocks until a heading for another section.
 * - The nutrition table is every remaining line in or after a block that
 *   names a nutrient or a per-100 basis. The nutrition parser (PAR-02) then
 *   decides which rows are real nutrients, using the line boxes.
 */

const INGREDIENTS_HEADING = /\bingred[i1l]ents?\b/i;

const NUTRITION_HINT =
  /\b(nutrition(al)?|energy|kcal|kj|protein|carbohydrate|sugars?|fat|saturates|saturated|sodium|salt|fibre|fiber|per\s*100\s*(g|ml)|serving)\b/i;

const STOP_HEADING =
  /\b(nutrition(al)?\s+(information|facts|value)|allergen\s+advice|storage|store\s+in|best\s+before|use\s+by|manufactured|marketed|packed\s+by|net\s+(wt|weight|quantity)|mrp|fssai|lic\.?\s*no|customer\s+care|batch|best\s+before)\b/i;

export interface LabelPanels {
  ingredientsText: string | null;
  nutritionFragments: NutritionTextFragment[];
}

function readingOrder(blocks: readonly OcrBlock[]): OcrBlock[] {
  return [...blocks].sort((a, b) => {
    const ay = a.box?.y ?? 0;
    const by = b.box?.y ?? 0;
    // Same visual row when tops are within half a line of each other.
    const lineHeight = Math.max(a.box?.height ?? 0, b.box?.height ?? 0, 1);
    if (Math.abs(ay - by) > Math.min(lineHeight, 24)) {
      return ay - by;
    }
    return (a.box?.x ?? 0) - (b.box?.x ?? 0);
  });
}

export function splitLabelPanels(page: OcrPage): LabelPanels {
  const blocks = readingOrder(page.blocks);
  const used = new Set<number>();

  // Ingredients.
  let ingredientsText: string | null = null;
  const start = blocks.findIndex((block) =>
    INGREDIENTS_HEADING.test(block.text),
  );
  if (start !== -1) {
    const first = blocks[start];
    const parts: string[] = [];
    if (first) {
      const lines = first.lines.map((line) => line.text);
      const headingLine = lines.findIndex((line) =>
        INGREDIENTS_HEADING.test(line),
      );
      // Keep the heading line: the ingredient parser strips "Ingredients:".
      parts.push(...lines.slice(Math.max(headingLine, 0)));
      used.add(start);
    }
    for (
      let index = start + 1;
      index < blocks.length && index <= start + 3;
      index++
    ) {
      const block = blocks[index];
      if (!block || STOP_HEADING.test(block.text) || looksLikeTableRow(block)) {
        break;
      }
      // A block far below the list is another section.
      const previous = blocks[index - 1];
      if (
        previous?.box &&
        block.box &&
        block.box.y - (previous.box.y + previous.box.height) >
          Math.max(previous.box.height, 40)
      ) {
        break;
      }
      parts.push(...block.lines.map((line) => line.text));
      used.add(index);
    }
    const joined = parts.join(' ').replace(/\s+/g, ' ').trim();
    ingredientsText = joined.length > 0 ? joined : null;
  }

  // Nutrition: lines from nutrition-looking blocks not used above.
  const nutritionFragments: NutritionTextFragment[] = [];
  const firstNutrition = blocks.findIndex(
    (block, index) => !used.has(index) && NUTRITION_HINT.test(block.text),
  );
  if (firstNutrition !== -1) {
    blocks.forEach((block, blockIndex) => {
      if (used.has(blockIndex)) {
        return;
      }
      const inTable = NUTRITION_HINT.test(block.text) || /\d/.test(block.text);
      if (!inTable) {
        return;
      }
      block.lines.forEach((line, lineIndex) => {
        if (!line.box || line.text.trim().length === 0) {
          return;
        }
        nutritionFragments.push({
          text: line.text,
          box: line.box,
          lineId: `b${blockIndex}l${lineIndex}`,
          blockId: `b${blockIndex}`,
        });
      });
    });
  }

  return { ingredientsText, nutritionFragments };
}

function looksLikeTableRow(block: OcrBlock): boolean {
  return (
    /^\s*(energy|protein|carbohydrate|total\s+sugars?|sugars?|fat|saturated|sodium|salt|fibre|fiber)\b/i.test(
      block.text,
    ) && /\d/.test(block.text)
  );
}
