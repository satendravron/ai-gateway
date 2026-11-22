import { describe, it, expect } from 'vitest';
import { LatencyAwareStrategy } from '../LatencyAwareStrategy';
import { CircuitBreaker } from '../CircuitBreaker';
import type { Provider } from '../../providers';

function makeProvider(name: string): Provider {
  return {
    name,
    chat: async () => ({ content: '', promptTokens: 0, completionTokens: 0, latencyMs: 0 }),
  };
}

describe('LatencyAwareStrategy', () => {
  it('selects provider with lowest ewmaMs * (1+inflight) score', () => {
    const strategy = new LatencyAwareStrategy();
    const providers = ['a', 'b', 'c'].map(makeProvider);
    const breakers = new Map<string, CircuitBreaker>();

    const ba = new CircuitBreaker('a');
    ba.ewmaMs = 500; ba.inflight = 2; // score = 500 * 3 = 1500

    const bb = new CircuitBreaker('b');
    bb.ewmaMs = 100; bb.inflight = 0; // score = 100 * 1 = 100 ← winner

    const bc = new CircuitBreaker('c');
    bc.ewmaMs = 200; bc.inflight = 0; // score = 200 * 1 = 200

    breakers.set('a', ba);
    breakers.set('b', bb);
    breakers.set('c', bc);

    expect(strategy.select(providers, breakers).name).toBe('b');
  });

  it('accounts for high inflight correctly', () => {
    const strategy = new LatencyAwareStrategy();
    const providers = ['x', 'y'].map(makeProvider);
    const breakers = new Map<string, CircuitBreaker>();

    const bx = new CircuitBreaker('x');
    bx.ewmaMs = 100; bx.inflight = 5; // score = 100 * 6 = 600

    const by = new CircuitBreaker('y');
    by.ewmaMs = 200; by.inflight = 0; // score = 200 * 1 = 200 ← winner

    breakers.set('x', bx);
    breakers.set('y', by);

    expect(strategy.select(providers, breakers).name).toBe('y');
  });

  it('returns single provider when only one available', () => {
    const strategy = new LatencyAwareStrategy();
    const providers = [makeProvider('solo')];
    const breakers = new Map<string, CircuitBreaker>();
    breakers.set('solo', new CircuitBreaker('solo'));

    expect(strategy.select(providers, breakers).name).toBe('solo');
  });
});
