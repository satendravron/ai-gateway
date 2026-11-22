import type { ChatRequest, ProviderResponse } from '@ai-gateway/shared';

export interface Provider {
  readonly name: string;
  chat(req: ChatRequest, signal: AbortSignal): Promise<ProviderResponse>;
}
