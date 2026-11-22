import { describe, it, expect } from 'vitest';
import { buildCacheKey, isCacheable } from './cache';

describe('buildCacheKey', () => {
  it('produces consistent keys for the same input', () => {
    const req = { model: 'gpt-4', messages: [{ role: 'user' as const, content: 'hello' }], temperature: 0 };
    expect(buildCacheKey(req)).toBe(buildCacheKey(req));
  });

  it('produces different keys for different prompts', () => {
    const r1 = { model: 'gpt-4', messages: [{ role: 'user' as const, content: 'hello' }] };
    const r2 = { model: 'gpt-4', messages: [{ role: 'user' as const, content: 'world' }] };
    expect(buildCacheKey(r1)).not.toBe(buildCacheKey(r2));
  });

  it('key starts with cache:', () => {
    const req = { model: 'm', messages: [{ role: 'user' as const, content: 'x' }] };
    expect(buildCacheKey(req)).toMatch(/^cache:/);
  });

  it('temperature 0 and undefined produce the same key', () => {
    const r1 = { model: 'm', messages: [{ role: 'user' as const, content: 'x' }], temperature: 0 as const };
    const r2 = { model: 'm', messages: [{ role: 'user' as const, content: 'x' }] };
    expect(buildCacheKey(r1 as Parameters<typeof buildCacheKey>[0])).toBe(buildCacheKey(r2));
  });
});

describe('isCacheable', () => {
  it('returns true when temperature is 0', () => {
    expect(isCacheable({ model: 'm', messages: [], temperature: 0 })).toBe(true);
  });

  it('returns true when temperature is undefined', () => {
    expect(isCacheable({ model: 'm', messages: [] })).toBe(true);
  });

  it('returns false when temperature > 0', () => {
    expect(isCacheable({ model: 'm', messages: [], temperature: 0.7 })).toBe(false);
  });

  it('returns false when temperature is 1', () => {
    expect(isCacheable({ model: 'm', messages: [], temperature: 1 })).toBe(false);
  });
});
