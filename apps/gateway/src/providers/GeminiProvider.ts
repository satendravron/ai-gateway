import type { ChatRequest, ProviderResponse } from '@ai-gateway/shared';
import type { Provider } from './index';

export class GeminiProvider implements Provider {
  public readonly name = 'gemini';
  constructor(private readonly apiKey: string) {}

  async chat(req: ChatRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const start = process.hrtime.bigint();
    const model = req.model || 'gemini-pro';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
    const contents = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents }),
      signal,
    });
    if (!response.ok) throw new Error(`Gemini ${response.status}`);
    const data = (await response.json()) as {
      candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
      usageMetadata: { promptTokenCount: number; candidatesTokenCount: number };
    };
    return {
      content: data.candidates[0]!.content.parts[0]!.text,
      promptTokens: data.usageMetadata.promptTokenCount,
      completionTokens: data.usageMetadata.candidatesTokenCount,
      latencyMs: Number(process.hrtime.bigint() - start) / 1_000_000,
    };
  }
}
