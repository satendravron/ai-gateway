import type { ChatRequest, ProviderResponse } from '@ai-gateway/shared';
import type { Provider } from './index';

export class OpenAIProvider implements Provider {
  public readonly name = 'openai';
  constructor(private readonly apiKey: string) {}

  async chat(req: ChatRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = process.hrtime.bigint();
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        temperature: req.temperature ?? 0,
        max_tokens: req.max_tokens,
      }),
      signal,
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: data.choices[0]!.message.content,
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens,
      latencyMs: Number(process.hrtime.bigint() - start) / 1_000_000,
    };
  }
}
