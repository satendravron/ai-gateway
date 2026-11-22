import type { ChatRequest, ProviderResponse } from '@ai-gateway/shared';
import type { Provider } from './index';

export class MockHttpProvider implements Provider {
  constructor(
    public readonly name: string,
    private readonly baseUrl: string
  ) {}

  async chat(req: ChatRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = process.hrtime.bigint();

    const response = await fetch(`${this.baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: req.model, messages: req.messages }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Provider ${this.name} returned ${response.status}: ${text}`);
    }

    const data = (await response.json()) as {
      content: string;
      usage: { prompt_tokens: number; completion_tokens: number };
    };

    const latencyMs = Number(process.hrtime.bigint() - start) / 1_000_000;

    return {
      content: data.content,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      latencyMs,
    };
  }
}
