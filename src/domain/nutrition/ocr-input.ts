/**
 * Engine-neutral text for one nutrition table.
 *
 * NAT-01 maps a recogniser onto this shape. ML Kit, Apple Vision, and fixtures
 * all stop at this file: this folder does not import an engine and does not see
 * the photograph.
 *
 * Every box in one call shares an origin. x increases to the right and y
 * increases downward, in the engine's own unit. A later call may use a
 * different unit. Do not mix engines inside one array.
 *
 * `lineId` joins fragments the engine already treated as one line. Fragments
 * with the same id stay on one row even when their boxes are slightly apart.
 * `blockId` is only a round-trip for the adapter. A block is often the whole
 * table, so it is not a row boundary.
 */
export interface NutritionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NutritionTextFragment {
  text: string;
  box: NutritionBoundingBox;
  lineId?: string;
  blockId?: string;
}
