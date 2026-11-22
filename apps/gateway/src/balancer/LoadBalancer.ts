import type { Provider } from '../providers';
import type { Strategy } from './Strategy';
import { CircuitBreaker } from './CircuitBreaker';
import { logger } from '../logger';
import type Redis from 'ioredis';

export class LoadBalancer {
  private breakers: Map<string, CircuitBreaker>;

  constructor(
    public readonly providers: Provider[],
    private readonly strategy: Strategy,
    private readonly redis: Redis
  ) {
    this.breakers = new Map(providers.map((p) => [p.name, new CircuitBreaker(p.name)]));
    this.startHealthPublisher();
  }

  getBreaker(name: string): CircuitBreaker {
    const b = this.breakers.get(name);
    if (!b) throw new Error(`No breaker for provider: ${name}`);
    return b;
  }

  healthyProviders(): Provider[] {
    return this.providers.filter((p) => {
      const b = this.breakers.get(p.name);
      return b?.canAttempt() ?? false;
    });
  }

  select(exclude: Set<string> = new Set()): Provider | null {
    const candidates = this.healthyProviders().filter((p) => !exclude.has(p.name));
    if (candidates.length === 0) return null;
    return this.strategy.select(candidates, this.breakers);
  }

  recordSuccess(name: string, latencyMs: number): void {
    this.breakers.get(name)?.recordSuccess(latencyMs);
  }

  recordFailure(name: string): void {
    this.breakers.get(name)?.recordFailure();
  }

  getState(): Array<{ name: string; state: string; ewmaMs: number; inflight: number; errorRate: number }> {
    return this.providers.map((p) => {
      const b = this.breakers.get(p.name)!;
      return {
        name: p.name,
        state: b.state,
        ewmaMs: Math.round(b.ewmaMs),
        inflight: b.inflight,
        errorRate: parseFloat(b.errorRate.toFixed(4)),
      };
    });
  }

  private startHealthPublisher(): void {
    setInterval(async () => {
      try {
        const state = this.getState();
        await this.redis.publish('providers:state', JSON.stringify(state));
      } catch (err) {
        logger.warn({ err }, 'Failed to publish provider state');
      }
    }, 2000);
  }
}
