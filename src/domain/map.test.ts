import { describe, expect, test } from 'bun:test';

import { canRenderNativeMap } from '@/domain/map';

describe('canRenderNativeMap', () => {
  test('blocks Android map initialization without a configured key', () => {
    expect(canRenderNativeMap('android', undefined)).toBeFalse();
    expect(canRenderNativeMap('android', '  ')).toBeFalse();
  });

  test('allows a keyed Android map and the native iOS map', () => {
    expect(canRenderNativeMap('android', 'restricted-key')).toBeTrue();
    expect(canRenderNativeMap('ios', undefined)).toBeTrue();
  });
});
