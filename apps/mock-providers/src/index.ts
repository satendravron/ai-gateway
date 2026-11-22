import express, { Request, Response } from 'express';

const app = express();
app.use(express.json());

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const NAME = process.env['NAME'] ?? 'provider-a';
const BASE_LATENCY_MS = parseInt(process.env['BASE_LATENCY_MS'] ?? '120', 10);
const JITTER_MS = parseInt(process.env['JITTER_MS'] ?? '30', 10);
const ERROR_RATE = parseFloat(process.env['ERROR_RATE'] ?? '0.01');

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', name: NAME });
});

app.post('/chat', async (req: Request, res: Response) => {
  const latency = BASE_LATENCY_MS + Math.random() * JITTER_MS;
  await sleep(latency);

  if (Math.random() < ERROR_RATE) {
    res.status(500).json({ error: 'simulated provider error', provider: NAME });
    return;
  }

  const messages: Array<{ role: string; content: string }> = req.body.messages ?? [];
  const promptText = messages.map((m) => m.content).join(' ');
  const content = `[${NAME}] Echo: ${promptText.slice(0, 100)}`;

  res.json({
    content,
    usage: {
      prompt_tokens: countTokens(promptText),
      completion_tokens: countTokens(content),
    },
  });
});

app.listen(PORT, () => {
  console.log(`Mock provider ${NAME} listening on :${PORT} (latency=${BASE_LATENCY_MS}ms jitter=${JITTER_MS}ms errorRate=${ERROR_RATE})`);
});
