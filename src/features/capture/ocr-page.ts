/**
 * Engine-neutral OCR output for one photo. The ML Kit adapter maps onto this
 * shape; the panel splitter and tests only see this. Coordinates are in the
 * photo's pixels: x to the right, y downward.
 */
export interface OcrBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrLine {
  text: string;
  box: OcrBox | null;
  languages: string[];
}

export interface OcrBlock {
  text: string;
  box: OcrBox | null;
  lines: OcrLine[];
}

export interface OcrPage {
  blocks: OcrBlock[];
}

export type OcrOutcome =
  | { status: 'read'; page: OcrPage }
  | { status: 'no_text' }
  | { status: 'unsupported_language'; script: string }
  | { status: 'engine_error'; message: string };
