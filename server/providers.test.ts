import { afterEach, describe, expect, test } from 'bun:test';

import { NormalizedHttpProvider } from './providers';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('normalized upstream health', () => {
  test('uses the authenticated health URL and accepts only successful responses', async () => {
    const requests: Array<{ url: string; authorization: string | null; redirect: RequestRedirect | undefined }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get('Authorization'),
        redirect: init?.redirect,
      });
      return new Response(null, { status: requests.length === 1 ? 204 : 503 });
    }) as typeof fetch;
    const provider = new NormalizedHttpProvider(
      'https://weather.example/v1/point',
      'https://weather.example/healthz',
      '1234567890123456',
    );
    expect(await provider.checkHealth(new AbortController().signal)).toBe(true);
    expect(await provider.checkHealth(new AbortController().signal)).toBe(false);
    expect(requests).toEqual([
      {
        url: 'https://weather.example/healthz',
        authorization: 'Bearer 1234567890123456',
        redirect: 'error',
      },
      {
        url: 'https://weather.example/healthz',
        authorization: 'Bearer 1234567890123456',
        redirect: 'error',
      },
    ]);
  });
});
