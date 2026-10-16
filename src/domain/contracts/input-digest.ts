/**
 * RFC 8785 (JSON Canonicalization Scheme) and the analysis inputDigest.
 *
 * The hash is SHA-256 over the UTF-8 bytes of the canonical JSON of the
 * request `product` value, after JSON.parse and before any schema default.
 * A missing field and a null field therefore stay distinct.
 */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

function compareUtf16(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function canonicalString(value: string): string {
  return JSON.stringify(value);
}

function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError('Canonical JSON cannot encode a non-finite number.');
  }
  // JSON.stringify uses the ECMAScript number format required by RFC 8785,
  // including the sign on the exponent and the treatment of negative zero.
  return JSON.stringify(value);
}

function plainRecord(value: object): Record<string, unknown> {
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError('Canonical JSON only encodes plain objects and arrays.');
  }
  const record: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    record[key] = Reflect.get(value, key);
  }
  return record;
}

/** Serialize one JSON value with sorted object keys and no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      return canonicalString(value);
    case 'number':
      return canonicalNumber(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      break;
    default:
      throw new TypeError(`Canonical JSON cannot encode ${typeof value}.`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const record = plainRecord(value);
  const members = Object.keys(record)
    .sort(compareUtf16)
    .map((key) => `${canonicalString(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(',')}}`;
}

/** Lowercase hex SHA-256 of the canonical JSON for one decoded product value. */
export function inputDigest(product: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalJson(product))));
}

/**
 * Digest `JSON.parse(body).product` for the exact analysis body the phone sent.
 * The rest of the body, including key order, is not part of the hash.
 */
export function inputDigestOfRequestBody(body: string): string {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Analysis request body must be a JSON object.');
  }
  if (!Object.hasOwn(parsed, 'product')) {
    throw new TypeError('Analysis request body has no product value.');
  }
  return inputDigest(Reflect.get(parsed, 'product'));
}
