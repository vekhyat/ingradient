/**
 * Local view models (plan/ui/components/00-local-views.md).
 *
 * Components only ever receive these shapes. A raw Open Food Facts document,
 * an OCR draft and a saved snapshot are all mapped here first. Personal data
 * is never a field on anything that leaves the phone.
 */

export type Letter = 'A' | 'B' | 'C' | 'D' | 'E';

export type FactKind =
  | { kind: 'read'; origin: 'off' | 'ocr' }
  | { kind: 'uncertain'; origin: 'ocr' | 'off'; cause: string }
  | { kind: 'corrected'; origin: 'user_correction'; previous: 'off' | 'ocr' }
  | {
      kind: 'estimated';
      origin: 'model_estimate';
      modelId: string;
      modelVersion: string;
    };

export type DataCredit = 'off' | 'label_photo' | 'mixed';

export type ImageCredit =
  | { source: 'off'; creator: string | null; licence: 'CC-BY-SA' }
  | { source: 'session'; imageId: string }
  | { source: 'none' };

export interface LocalProductView {
  productId: string;
  barcode: string | null;
  name: string | null;
  brand: string | null;
  sizeText: string | null;
  image: ImageCredit;
  retrievedAt: string | null;
  dataCredit: DataCredit;
  categoryLabel: string | null;
}

export interface IngredientOccurrence {
  occurrenceId: string;
  packOrder: number;
  printedText: string;
  canonicalId: string | null;
  match: 'matched' | 'ambiguous' | 'unresolved';
  kind: FactKind;
  nestedIn: string | null;
  depth: number;
}

export interface PanelPresence {
  panel: 'ingredients' | 'nutrition';
  state: 'read' | 'uncertain' | 'missing' | 'user_marked_absent';
  imageId: string | null;
}

/** One nutrient row. `value: null` is unknown, never zero. */
export interface AmountView {
  field: string;
  label: string;
  value: number | null;
  unit: string;
  basis: string;
  kind: FactKind | null;
  missingReason: string | null;
}

export type ScientificView =
  | {
      status: 'supported';
      letter: Letter;
      methodId: string;
      methodVersion: string;
      reasonIds: string[];
    }
  | { status: 'insufficient_data'; gaps: string[] }
  | { status: 'method_unavailable'; gaps: string[] }
  | {
      status: 'unsupported';
      reason: 'category' | 'method' | 'region';
      detail: string;
    };

/** S1 never builds a personal assessment; S3 adds the other branches. */
export type PersonalView =
  | { status: 'not_in_slice' }
  | { status: 'product_alone' }
  | { status: 'unavailable'; cause: string };

export interface ReasonView {
  id: string;
  text: string;
  citationIds: string[];
  inputText: string;
}

export interface CitationView {
  id: string;
  title: string;
  issuer: string;
  edition: string;
  locator: string;
  claim: string;
  url: string | null;
}

export type AnalysisExecutor = 'backend' | 'phone';

export interface MethodView {
  id: string;
  edition: string;
  label: string;
}

export interface ResultView {
  /** Stable identity used for reveal motion and update offers. */
  resultKey: string;
  product: LocalProductView;
  science: ScientificView;
  personal: PersonalView;
  /** A one-sentence sourced summary when available. */
  summary: string | null;
  reasons: ReasonView[];
  citations: Record<string, CitationView>;
  ingredients: IngredientOccurrence[];
  nutrients: AmountView[];
  panels: PanelPresence[];
  method: MethodView | null;
  executor: AnalysisExecutor | null;
  analysedAt: string | null;
}

export type LookupFailure =
  | { status: 'invalid_code' }
  | { status: 'absent' }
  | { status: 'offline' }
  | { status: 'timeout' }
  | { status: 'throttled'; retryAfterSeconds: number | null }
  | { status: 'upstream_unavailable' }
  | { status: 'malformed' }
  | { status: 'cancelled' };
