import TextRecognition, {
  TextRecognitionScript,
  type TextRecognitionResult,
} from '@react-native-ml-kit/text-recognition';

import type {
  OcrBlock,
  OcrBox,
  OcrOutcome,
  OcrPage,
} from '../../features/capture/ocr-page';

/**
 * On-device text recognition with Google ML Kit (D67). The Latin model is
 * bundled in the app, so it works offline from a fresh install. The photo
 * never leaves the phone.
 */

function toBox(frame?: {
  left: number;
  top: number;
  width: number;
  height: number;
}): OcrBox | null {
  if (!frame) {
    return null;
  }
  return {
    x: frame.left,
    y: frame.top,
    width: frame.width,
    height: frame.height,
  };
}

export function toOcrPage(result: TextRecognitionResult): OcrPage {
  const blocks: OcrBlock[] = result.blocks.map((block) => ({
    text: block.text,
    box: toBox(block.frame),
    lines: block.lines.map((line) => ({
      text: line.text,
      box: toBox(line.frame),
      languages: line.recognizedLanguages.map((lang) => lang.languageCode),
    })),
  }));
  return { blocks };
}

const LETTER = /[A-Za-z]/;

function latinLetters(page: OcrPage): number {
  let count = 0;
  for (const block of page.blocks) {
    for (const char of block.text) {
      if (LETTER.test(char)) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Reads one photo. When the Latin reader finds almost nothing, the
 * Devanagari reader is tried only to name the problem: S1 reads English
 * labels, so a Hindi-only label gets an explicit "not supported" state, not
 * a guessed result.
 */
export async function recogniseLabel(uri: string): Promise<OcrOutcome> {
  let latin: OcrPage;
  try {
    latin = toOcrPage(
      await TextRecognition.recognize(uri, TextRecognitionScript.LATIN),
    );
  } catch (error) {
    return { status: 'engine_error', message: (error as Error).message };
  }
  if (latinLetters(latin) >= 12) {
    return { status: 'read', page: latin };
  }
  try {
    const devanagari = await TextRecognition.recognize(
      uri,
      TextRecognitionScript.DEVANAGARI,
    );
    if (devanagari.text.replace(/\s/g, '').length >= 12) {
      return { status: 'unsupported_language', script: 'Devanagari' };
    }
  } catch {
    // Fall through: the Latin result decides.
  }
  return latinLetters(latin) > 0
    ? { status: 'read', page: latin }
    : { status: 'no_text' };
}
