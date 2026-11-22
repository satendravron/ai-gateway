import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker } from '../CircuitBreaker';

describe('CircuitBreaker', () => {
  let breaker: CircuitBreaker;

  beforeEach(() => {
    breaker = new CircuitBreaker('test');
  });

  it('starts CLOSED', () => {
    expect(breaker.state).toBe('CLOSED');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('opens after 5 consecutive failures', () => {
    for (let i = 0; i < 5; i++) {
      breaker.incrementInflight();
      breaker.recordFailure();
    }
    expect(breaker.state).toBe('OPEN');
    expect(breaker.canAttempt()).toBe(false);
  });

  it('opens after >50% errors in 20-call window', () => {
    // 11 failures out of 20 = 55% — but consecutive threshold hits first at 5
    // So reset consecutiveFailures by interleaving with successes
    for (let i = 0; i < 20; i++) {
      breaker.incrementInflight();
      if (i % 2 === 0) {
        // success resets consecutive count
        breaker.recordSuccess(100);
      } else {
        breaker.recordFailure();
      }
    }
    // After 10 successes and 10 failures = 50% errors (not > 50%), not open
    expect(breaker.state).toBe('CLOSED');

    // Now push one more failure = 11/21 > 50%
    breaker.incrementInflight();
    breaker.recordFailure();
    expect(breaker.state).toBe('OPEN');
  });

  it('transitions OPEN -> HALF_OPEN after 10s', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      breaker.incrementInflight();
      breaker.recordFailure();
    }
    expect(breaker.state).toBe('OPEN');
    vi.advanceTimersByTime(10_001);
    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.state).toBe('HALF_OPEN');
    vi.useRealTimers();
  });

  it('transitions HALF_OPEN -> CLOSED on success', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      breaker.incrementInflight();
      breaker.recordFailure();
    }
    vi.advanceTimersByTime(10_001);
    breaker.canAttempt(); // triggers HALF_OPEN + allows probe
    breaker.incrementInflight();
    breaker.recordSuccess(100);
    expect(breaker.state).toBe('CLOSED');
    vi.useRealTimers();
  });

  it('stays OPEN if second canAttempt called in HALF_OPEN with no probe used', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 5; i++) {
      breaker.incrementInflight();
      breaker.recordFailure();
    }
    vi.advanceTimersByTime(10_001);
    breaker.canAttempt(); // moves to HALF_OPEN, probe allowed consumed
    expect(breaker.canAttempt()).toBe(false); // second call: no probe left
    vi.useRealTimers();
  });

  it('updates EWMA on success', () => {
    const initial = breaker.ewmaMs;
    breaker.incrementInflight();
    breaker.recordSuccess(10); // much lower latency
    expect(breaker.ewmaMs).toBeLessThan(initial);
  });
});
