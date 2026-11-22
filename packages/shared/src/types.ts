export type ProviderState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface ProviderStatus {
  name: string;
  state: ProviderState;
  ewmaMs: number;
  inflight: number;
  errorRate: number;
}

export interface LogEvent {
  requestId: string;
  ts: string; // ISO
  apiKeyId: number | null;
  provider: string | null;
  model: string;
  cacheHit: boolean;
  statusCode: number;
  errorType: string | null;
  totalLatencyMs: number;
  gatewayOverheadMs: number;
  retryMs?: number;
  promptTokens: number;
  completionTokens: number;
}

export interface MetricsSnapshot {
  ts: string; // ISO
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

export interface WsMessage {
  type: 'hello' | 'metrics' | 'providers';
  data: unknown;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface ProviderResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}
