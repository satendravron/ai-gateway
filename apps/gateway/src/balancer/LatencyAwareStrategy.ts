import type { Provider } from '../providers';
import type { Strategy } from './Strategy';
import type { CircuitBreaker } from './CircuitBreaker';

export class LatencyAwareStrategy implements Strategy {
  select(providers: Provider[], breakers: Map<string, CircuitBreaker>): Provider {
    let best: Provider | null = null;
    let bestScore = Infinity;

    for (const p of providers) {
      const b = breakers.get(p.name);
      if (!b) continue;
      const score = b.ewmaMs * (1 + b.inflight);
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }

    return best ?? providers[0]!;
  }
}
