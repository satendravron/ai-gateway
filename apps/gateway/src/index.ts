import express from 'express';
import { createClient } from './redis';
import { createPool } from './db';
import { authMiddleware } from './middleware/auth';
import { chatRouter } from './routes/chat';
import { logger } from './logger';
import { LoadBalancer } from './balancer/LoadBalancer';
import { LatencyAwareStrategy } from './balancer/LatencyAwareStrategy';
import { MockHttpProvider } from './providers/MockHttpProvider';
import { OpenAIProvider } from './providers/OpenAIProvider';
import { AnthropicProvider } from './providers/AnthropicProvider';
import { GeminiProvider } from './providers/GeminiProvider';
import type { Provider } from './providers';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '4000', 10);

async function main() {
  const redis = createClient();
  const db = createPool();

  // Build provider list
  const providers: Provider[] = [
    new MockHttpProvider('provider-a', process.env['MOCK_A_URL'] ?? 'http://localhost:3001'),
    new MockHttpProvider('provider-b', process.env['MOCK_B_URL'] ?? 'http://localhost:3002'),
    new MockHttpProvider('provider-c', process.env['MOCK_C_URL'] ?? 'http://localhost:3003'),
  ];

  // Add real providers only if keys present
  if (process.env['OPENAI_API_KEY']) providers.push(new OpenAIProvider(process.env['OPENAI_API_KEY']));
  if (process.env['ANTHROPIC_API_KEY']) providers.push(new AnthropicProvider(process.env['ANTHROPIC_API_KEY']));
  if (process.env['GEMINI_API_KEY']) providers.push(new GeminiProvider(process.env['GEMINI_API_KEY']));

  const balancer = new LoadBalancer(providers, new LatencyAwareStrategy(), redis);

  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => res.json({ status: 'ok', providers: providers.length }));

  app.use('/v1', authMiddleware(redis, db));
  app.use('/v1', chatRouter(balancer, redis));

  app.listen(PORT, () => {
    logger.info({ port: PORT, providers: providers.map((p) => p.name) }, 'Gateway listening');
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
