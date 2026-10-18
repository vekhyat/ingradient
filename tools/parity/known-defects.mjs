/**
 * Adversarial findings that are reported, not fixed (the parity task may not
 * edit product code). Keyed `<case>:<measure>`. A listed finding prints as
 * KNOWN DEFECT and does not fail the run; a new finding fails it, and so does a
 * listed finding that no longer reproduces (strict expected failure), so this
 * list cannot go stale. Remove an entry when its fix lands.
 */
const ENERGY =
  'defect: backend has no energy ceiling (backend/app/analysis/calculator.py:235) but the phone refuses energy above 3800 kJ/100 (src/domain/scientific/nutri-score.ts:135,655)';
const SURROGATE =
  'defect: phone sends an unpaired surrogate (src/domain/hybrid/request.ts:159,173; wire validator accepts at :223); backend refuses it under RFC 8785 (backend/app/api/analyses.py:103)';
const FIELD =
  'defect: a server issue.field string is kept in the phone result (src/domain/contracts/map-analyze-response.ts:93, src/adapters/backend/backend-issues.ts:116); stored, not displayed (src/view-models/map-result.ts:239)';
const UNREACHABLE_SOURCE =
  'unreachable: the phone wire validator cannot express unique sourceRef ids (backend/app/contract/models.py:394); the phone builder never emits duplicates (src/domain/hybrid/request.ts:123)';
const UNREACHABLE_KEY =
  'unreachable: JSON.parse keeps the last duplicate key, the backend refuses it; the phone serialises with JSON.stringify, which cannot emit one';

export const KNOWN_DEFECTS = {
  'adv-energy-above-3800kj:backend': ENERGY,
  'adv-energy-above-3800kj:state': ENERGY,
  'adv-inject-lone-surrogate:wire': SURROGATE,
  'adv-inject-lone-surrogate:state': SURROGATE,
  'adv-inject-lone-surrogate-gap:wire': SURROGATE,
  'adv-inject-lone-surrogate-gap:state': SURROGATE,
  'tamper-script-field:phone': FIELD,
  'adv-wire-duplicate-source-ref:wire': UNREACHABLE_SOURCE,
  'adv-wire-duplicate-json-key:wire': UNREACHABLE_KEY,
};
