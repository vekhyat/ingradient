import { validationDetail, wireValidators } from '../../domain/contracts';
import { MAX_REQUEST_BYTES, type RecordedRequest } from './types';

const DISALLOWED_FIELD_NAMES = new Set([
  'account',
  'accountid',
  'allergies',
  'allergy',
  'behaviour',
  'behavior',
  'coordinates',
  'crop',
  'crops',
  'device',
  'deviceid',
  'diet',
  'expoinstallationid',
  'feedback',
  'history',
  'image',
  'imagebase64',
  'images',
  'installationid',
  'learning',
  'personal',
  'photo',
  'photos',
  'preferences',
  'profile',
  'sessionid',
  'userid',
]);

const DISALLOWED_VALUE_PATTERNS = [
  /expo-install/i,
  /device-id/i,
  /account-id/i,
  /session-id/i,
];

function normalizedToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function nameIsSensitive(name: string): boolean {
  const token = normalizedToken(name);
  if (DISALLOWED_FIELD_NAMES.has(token)) {
    return true;
  }
  for (const blocked of DISALLOWED_FIELD_NAMES) {
    if (blocked.length >= 4 && token.includes(blocked)) {
      return true;
    }
  }
  return false;
}

function matchedValuePattern(value: string): RegExp | null {
  for (const pattern of DISALLOWED_VALUE_PATTERNS) {
    if (pattern.test(value)) {
      return pattern;
    }
  }
  return null;
}

/**
 * Walk a JSON value. The thrown message names the field or pattern and does
 * not include the matched text, so a test failure cannot log the secret.
 */
function checkDisallowedKeysAndValues(obj: unknown, path = ''): string | null {
  if (obj === null || obj === undefined) {
    return null;
  }
  if (typeof obj === 'string') {
    const pattern = matchedValuePattern(obj);
    if (pattern) {
      return `Disallowed pattern "${String(pattern)}" in a string value at ${path || 'root'}`;
    }
    return null;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const err = checkDisallowedKeysAndValues(obj[i], `${path}[${i}]`);
      if (err) {
        return err;
      }
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj)) {
      if (nameIsSensitive(key)) {
        return `Disallowed sensitive field "${key}" detected at ${path || 'root'}`;
      }
      const err = checkDisallowedKeysAndValues(
        value,
        path ? `${path}.${key}` : key,
      );
      if (err) {
        return err;
      }
    }
  }
  return null;
}

function parseCandidateBody(candidate: unknown): unknown {
  if (typeof candidate === 'string') {
    try {
      return JSON.parse(candidate);
    } catch {
      return candidate;
    }
  }
  return candidate;
}

function inspectSingleRequest(requestBody: unknown): void {
  const parsed = parseCandidateBody(requestBody);

  const disallowedError = checkDisallowedKeysAndValues(parsed);
  if (disallowedError) {
    throw new Error(`Wire privacy violation: ${disallowedError}`);
  }

  const isValid = wireValidators.AnalyzeRequest(parsed);
  if (!isValid) {
    const detail = validationDetail(wireValidators.AnalyzeRequest);
    throw new Error(`Wire contract validation rejected request: ${detail}`);
  }
}

function inspectAddress(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url, 'https://analysis.ingradient.invalid');
  } catch {
    throw new Error('Wire privacy violation: request URL could not be read');
  }
  const pathPattern = matchedValuePattern(parsed.pathname);
  if (pathPattern) {
    throw new Error(
      `Wire privacy violation: Disallowed pattern "${String(pathPattern)}" in request URL`,
    );
  }
  parsed.searchParams.forEach((value, key) => {
    if (nameIsSensitive(key)) {
      throw new Error(
        `Wire privacy violation: Disallowed query parameter "${key}"`,
      );
    }
    const valuePattern = matchedValuePattern(value);
    if (valuePattern) {
      throw new Error(
        `Wire privacy violation: Disallowed pattern "${String(valuePattern)}" in query parameter "${key}"`,
      );
    }
  });
}

function inspectHeaders(headers: Readonly<Record<string, string>>): void {
  for (const [key, value] of Object.entries(headers)) {
    if (nameIsSensitive(key)) {
      throw new Error(`Wire privacy violation: Disallowed header "${key}"`);
    }
    const valuePattern = matchedValuePattern(value);
    if (valuePattern) {
      throw new Error(
        `Wire privacy violation: Disallowed pattern "${String(valuePattern)}" in header "${key}"`,
      );
    }
  }
}

function isRecordedRequest(value: unknown): value is RecordedRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    'url' in value &&
    'method' in value &&
    'headers' in value &&
    'rawBody' in value
  );
}

function inspectRecordedRequest(request: RecordedRequest): void {
  inspectAddress(request.url);
  inspectHeaders(request.headers);
  // GET /health has a null body. That is not an AnalyzeRequest.
  if (
    request.rawBody === '' &&
    (request.body === null || request.body === undefined)
  ) {
    return;
  }
  if (request.byteLength > MAX_REQUEST_BYTES) {
    return;
  }
  const payload = request.rawBody !== '' ? request.rawBody : request.body;
  inspectSingleRequest(payload);
}

/**
 * Assert that a wire call did not carry photos, profile, allergy, learning,
 * account or device data in the URL, the query, the headers or the body.
 *
 * Accepts one request body, one recorded call, an array of recorded calls,
 * or a transport with getRecordedRequests(). A warm-up GET /health in that
 * array is checked for its URL and headers only.
 */
export function assertNoSensitiveWireData(target: unknown): void {
  if (!target) {
    return;
  }

  if (
    typeof target === 'object' &&
    'getRecordedRequests' in target &&
    typeof (target as { getRecordedRequests: unknown }).getRecordedRequests ===
      'function'
  ) {
    const requests = (
      target as { getRecordedRequests(): readonly RecordedRequest[] }
    ).getRecordedRequests();
    for (const request of requests) {
      inspectRecordedRequest(request);
    }
    return;
  }

  if (Array.isArray(target)) {
    for (const item of target) {
      if (isRecordedRequest(item)) {
        inspectRecordedRequest(item);
      } else {
        inspectSingleRequest(item);
      }
    }
    return;
  }

  if (isRecordedRequest(target)) {
    inspectRecordedRequest(target);
    return;
  }

  inspectSingleRequest(target);
}
