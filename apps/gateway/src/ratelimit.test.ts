import { describe, it, expect, vi, beforeEach } from 'vitest';

// Build mock in-memory redis
const store = new Map<string, number>();
const mockRedis = {
  incr: vi.fn(async (key: string) => {
    const val = (store.get(key) ?? 0) + 1;
    store.set(key, val);
    return val;
  }),
  expire: vi.fn(async () => 1),
};

vi.mock('../redis', () => ({ createClient: vi.fn(() => mockRedis) }));

import { checkRateLimit } from './ratelimit';

describe('checkRateLimit', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    mockRedis.incr.mockImplementation(async (key: string) => {
      const val = (store.get(key) ?? 0) + 1;
      store.set(key, val);
      return val;
    });
  });

  it('allows first request', async () => {
    const result = await checkRateLimit(mockRedis as never, 1, 100);
    expect(result.allowed).toBe(true);
    expect(result.retryAfterS).toBe(0);
  });

  it('allows requests up to the limit', async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit(mockRedis as never, 2, 5);
      expect(r.allowed).toBe(true);
    }
  });

  it('blocks when count exceeds limit', async () => {
    // Push beyond limit
    mockRedis.incr.mockResolvedValueOnce(11);
    const result = await checkRateLimit(mockRedis as never, 99, 10);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterS).toBeGreaterThan(0);
  });

  it('calls EXPIRE only on first increment', async () => {
    // First call: incr returns 1 -> expire called
    await checkRateLimit(mockRedis as never, 3, 100);
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
    // Second call: incr returns 2 -> expire NOT called again
    await checkRateLimit(mockRedis as never, 3, 100);
    expect(mockRedis.expire).toHaveBeenCalledTimes(1);
  });
});
