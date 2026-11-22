import type { ChatRequest, ProviderResponse } from '@ai-gateway/shared';
import type { Provider } from './index';

export class AnthropicProvider implements Provider {
  public readonly name = 'anthropic';
  constructor(private readonly apiKey: string) {}

  async chat(req: ChatRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = process.hrtime.bigint();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.max_tokens ?? 1024,
        messages: req.messages,
      }),
      signal,
    });
    if (!response.ok) throw new Error(`Anthropic ${response.status}`);
    const data = (await response.json()) as {
      content: Array<{ text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };
    return {
      content: data.content[0]!.text,
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
      latencyMs: Number(process.hrtime.bigint() - start) / 1_000_000,
    };
  }
}
