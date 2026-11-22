import type { Provider } from '../providers';
import type { CircuitBreaker } from './CircuitBreaker';

export interface Strategy {
  select(providers: Provider[], breakers: Map<string, CircuitBreaker>): Provider;
}
