/**
 * @jest-environment node
 */

import { describe, expect, it } from '@jest/globals';
import { createCatalogueAdapter } from './off-adapter';
import { buildOffUserAgent } from './user-agent';

describe('buildOffUserAgent', () => {
  it('identifies the app, platform and version', () => {
    expect(buildOffUserAgent('android', '0.1.0')).toBe(
      'Ingradient - Android - Version 0.1.0 - https://github.com/vekhyat/ingradient',
    );
    expect(buildOffUserAgent('ios', '1.2.3')).toContain(
      'Ingradient - iOS - Version 1.2.3',
    );
  });

  it('falls back to a non-empty version', () => {
    expect(buildOffUserAgent('android', '  ')).toContain('Version 0.0.0');
  });

  it('carries no email or personal contact detail', () => {
    const ua = buildOffUserAgent('android', '0.1.0');
    expect(ua).not.toMatch(/@/);
    expect(ua).not.toMatch(/mailto:|tel:/i);
  });

  it('reaches the request header unchanged through the adapter', async () => {
    const expected = buildOffUserAgent('android', '0.1.0');
    let seen: string | undefined;
    const fakeFetch: typeof fetch = async (_url, init) => {
      seen = (init?.headers as Record<string, string>)['User-Agent'];
      return new Response(JSON.stringify({ status: 'failure' }), {
        status: 404,
      });
    };
    await createCatalogueAdapter({
      userAgent: expected,
      fetch: fakeFetch,
    }).lookupBarcode('8901063012493');
    expect(seen).toBe(expected);
  });
});
