import type { Provider } from '../providers';
import type { Strategy } from './Strategy';
import type { CircuitBreaker } from './CircuitBreaker';

export class WeightedRoundRobinStrategy implements Strategy {
  private counter = 0;

  select(providers: Provider[], _breakers: Map<string, CircuitBreaker>): Provider {
    const index = this.counter % providers.length;
    this.counter++;
    return providers[index]!;
  }
}
