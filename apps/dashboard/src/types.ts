export interface MetricsSnapshot {
  ts: string;
  requests: number;
  errors: number;
  cacheHits: number;
  promptTokens: number;
  completionTokens: number;
  p50: number;
  p95: number;
  p99: number;
  byProvider: Record<string, { requests: number; errors: number; cacheHits: number }>;
}

export interface ProviderStatus {
  name: string;
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  ewmaMs: number;
  inflight: number;
  errorRate: number;
}

export interface LogEntry {
  id: number;
  ts: string;
  request_id: string;
  provider: string;
  model: string;
  cache_hit: boolean;
  status_code: number;
  error_type: string | null;
  total_latency_ms: number;
  gateway_overhead_ms: number;
  prompt_tokens: number;
  completion_tokens: number;
}
