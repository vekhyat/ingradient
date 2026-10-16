import {
  inputDigest,
  inputDigestOfRequestBody,
  wireValidators,
} from '../../domain/contracts';
import { MAX_REQUEST_BYTES } from './types';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  Citation,
  Health,
  MethodRef,
  Problem,
  ProductAnalysisInput,
  ScientificAssessment,
} from '../../domain/contracts/generated/wire';

const ZERO_HASH =
  '0000000000000000000000000000000000000000000000000000000000000000';
const METHOD_LABEL = 'Nutrition grade · European reference' as const;

export const MOCK_CITATION: Citation = {
  id: 'spf-faq-v11',
  title: 'Nutri-Score FAQ (Version 11)',
  issuer: 'Santé publique France',
  url: 'https://www.santepubliquefrance.fr',
  edition: 'faq-v11-2025-03-17',
  locator: 'Section 4',
  claimScope: 'general',
  checkedAt: '2026-10-16',
};

export const MOCK_HTML_WAKEUP = `<!DOCTYPE html>
<html>
<head><title>Ingradient Service Spin-Up</title></head>
<body>
  <h1>Service Waking Up</h1>
  <p>The backend service is starting up from idle state. Please re-send your request.</p>
</body>
</html>`;

export function buildMockHealth(): Health {
  const health: Health = {
    status: 'ok',
    contractVersion: '0.2.0-draft',
  };
  if (!wireValidators.Health(health)) {
    throw new Error('Mock Health response failed schema validation.');
  }
  return health;
}

/** Contract 413 text, including the frozen 262144-byte bound. */
export function payloadTooLargeMessage(): string {
  return `Product request exceeds the accepted size bound of ${MAX_REQUEST_BYTES} bytes.`;
}

export function buildMockProblem(
  code: Problem['code'],
  message: string,
  retryAfterSeconds?: number,
): Problem {
  const problem: Problem = {
    code,
    message,
    ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
  };
  if (!wireValidators.Problem(problem)) {
    throw new Error(`Mock Problem failed schema validation: ${code}`);
  }
  return problem;
}

export interface AnalyzeResponseOptions {
  digestMismatch?: boolean;
  editionMismatch?: boolean;
  bundleHashMismatch?: boolean;
  staleInput?: boolean;
}

function requestFromExactBody(rawBody: string): AnalyzeRequest {
  const parsed: unknown = JSON.parse(rawBody);
  if (!wireValidators.AnalyzeRequest(parsed)) {
    throw new Error('Mock analysis request failed schema validation.');
  }
  // Ajv returns a boolean, so this narrows only after the frozen validator passed.
  return parsed as AnalyzeRequest;
}

const STALE_PRODUCT: ProductAnalysisInput = {
  barcode: '5449000000996',
  name: 'Stale Formulation Cola',
  market: 'EU',
  ingredientsText: 'Carbonated water, sugar, caramel color, phosphoric acid',
  ingredientsStatus: 'complete',
  observations: [
    {
      field: 'energy',
      kind: 'read',
      value: 180,
      unit: 'kJ',
      basis: 'per_100_ml',
      sourceIds: ['src-0'],
      issues: [],
    },
    {
      field: 'sugars',
      kind: 'read',
      value: 10.6,
      unit: 'g',
      basis: 'per_100_ml',
      sourceIds: ['src-0'],
      issues: [],
    },
  ],
  sourceRefs: [
    {
      id: 'src-0',
      kind: 'label',
      title: 'Combined label photo',
    },
  ],
  issues: [],
};

export function buildMockAnalyzeResponse(
  requestInput: AnalyzeRequest | string,
  options: AnalyzeResponseOptions = {},
): AnalyzeResponse {
  // Hash JSON.parse of the exact text that will be sent, including when the
  // caller passed an object. Key order and undefined fields must not leak in.
  const rawBody =
    typeof requestInput === 'string'
      ? requestInput
      : JSON.stringify(requestInput);
  const req = requestFromExactBody(rawBody);
  const activeProduct = options.staleInput ? STALE_PRODUCT : req.product;

  let computedDigest: string;
  if (options.digestMismatch) {
    computedDigest = ZERO_HASH;
  } else if (options.staleInput) {
    computedDigest = inputDigest(STALE_PRODUCT);
  } else {
    computedDigest = inputDigestOfRequestBody(rawBody);
  }

  const snapshotId = 'mock-analyzed-snapshot-1';
  const methodEdition = options.editionMismatch
    ? 'faq-v10-2023-outdated'
    : (req.resourceCompatibility?.methodEdition ?? 'faq-v11-2025-03-17');

  const bundleSha256 = options.bundleHashMismatch
    ? 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
    : (req.resourceCompatibility?.methodBundleSha256 ?? ZERO_HASH);

  const method: MethodRef = {
    id: 'nutriscore-updated-2023',
    edition: methodEdition,
    bundleId: 'fixture-method-1',
    bundleSha256,
    label: METHOD_LABEL,
  };

  const scientific: ScientificAssessment = {
    state: 'graded',
    grade: 'C',
    score: 5,
    route: 'general',
    method,
    inputSnapshotId: snapshotId,
    reasons: [
      {
        id: 'mock-reason-sugars',
        templateId: 'fixture.reason',
        text: 'Moderate sugar contribution to energy density.',
        citationIds: [MOCK_CITATION.id],
        inputFields: ['sugars'],
        step: 'sugars-points',
      },
    ],
    trace: [
      {
        component: 'sugars',
        inputFields: ['sugars'],
        points: 3,
        ruleLocator: 'Table 1: Nutri-Score General Food Rules',
        citationIds: [MOCK_CITATION.id],
      },
    ],
    issues: [],
  };

  const response: AnalyzeResponse = {
    contractVersion: '0.2.0-draft',
    product: {
      id: snapshotId,
      barcode: activeProduct.barcode ?? null,
      name: activeProduct.name ?? null,
      market: activeProduct.market ?? 'unknown',
      sourceRefs:
        activeProduct.sourceRefs && activeProduct.sourceRefs.length > 0
          ? [...activeProduct.sourceRefs]
          : [
              {
                id: 'src-0',
                kind: 'label',
                title: 'Ingredient panel',
              },
            ],
      observations:
        activeProduct.observations && activeProduct.observations.length > 0
          ? [...activeProduct.observations]
          : [],
      ingredients: [],
      category: 'general',
      taxonomyVersion:
        req.resourceCompatibility?.taxonomyVersion ?? 'fictional-taxonomy',
      evidenceVersion:
        req.resourceCompatibility?.evidenceVersion ?? 'fictional-evidence',
    },
    scientific,
    citations: [MOCK_CITATION],
    issues: [],
    inputDigest: computedDigest,
  };

  if (!wireValidators.AnalyzeResponse(response)) {
    throw new Error('Mock AnalyzeResponse failed schema validation.');
  }

  return response;
}
