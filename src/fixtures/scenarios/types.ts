import type {
  Issue,
  LocalAssessment,
  ProductSnapshot,
} from '../../domain/contracts/generated/local';

export type LocalScenarioName =
  | 'complete_graded'
  | 'missing_nutrients'
  | 'unsupported_category'
  | 'conflicting_sources'
  | 'throttled_lookup'
  | 'cancelled_scan';

/**
 * Local adapter result for direct OFF reads or scan outcome,
 * matching $defs.LookupOutcome from local-contract.schema.json.
 */
export type LookupOutcome =
  | {
      readonly state: 'found';
      readonly snapshot: ProductSnapshot;
    }
  | {
      readonly state:
        | 'invalid'
        | 'absent'
        | 'offline'
        | 'timeout'
        | 'throttled'
        | 'upstream_unavailable'
        | 'malformed'
        | 'cancelled';
      readonly issues: readonly Issue[];
      readonly retryAfterSeconds?: number;
    };

export interface LocalScenario {
  readonly name: LocalScenarioName;
  readonly description: string;
  readonly snapshot: ProductSnapshot;
  readonly assessment: LocalAssessment;
  readonly lookupOutcome: LookupOutcome;
}
