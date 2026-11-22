import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { chatRequestSchema } from '@ai-gateway/shared';
import type Redis from 'ioredis';
import type { LoadBalancer } from '../balancer/LoadBalancer';
import { buildCacheKey, getFromCache, isCacheable, setInCache } from '../cache';
import { checkRateLimit } from '../ratelimit';
import { logger } from '../logger';
import type { LogEvent, ChatRequest, ProviderResponse } from '@ai-gateway/shared';

// In-process coalescing map: cacheKey -> Promise<ProviderResponse & { failoverCount: number; totalProviderMs: number; retryMs: number }>
const coalescing = new Map<string, Promise<ProviderResponse & { failoverCount: number; totalProviderMs: number; retryMs: number }>>();

export function chatRouter(balancer: LoadBalancer, redis: Redis): Router {
  const router = Router();

  router.post('/chat/completions', async (req: Request, res: Response): Promise<void> => {
    const totalStart = process.hrtime.bigint();
    const requestId = uuidv4();

    res.setHeader('X-Request-Id', requestId);

    // Validate body
    const parsed = chatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const chatReq = parsed.data;
    const apiKeyId = req.apiKeyId ?? 0;
    const limitPerMin = req.rateLimitPerMin ?? 6000;

    // Rate limit
    try {
      const rl = await checkRateLimit(redis, apiKeyId, limitPerMin);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterS));
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
      }
    } catch (err) {
      logger.warn({ err }, 'Rate limit check failed; allowing request');
    }

    // Cache
    const bypass = req.headers['cache-control'] === 'no-cache';
    const cacheable = isCacheable(chatReq) && !bypass;
    const cacheKey = buildCacheKey(chatReq);

    if (cacheable) {
      const cached = await getFromCache(redis, cacheKey);
      if (cached) {
        const totalMs = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
        const overhead = Math.round(totalMs);
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('X-Provider', 'cache');
        res.setHeader('X-Gateway-Overhead-Ms', String(overhead));
        res.setHeader('X-Retry-Ms', '0');
        res.setHeader('X-Failovers', '0');
        const cachedData = JSON.parse(cached) as { content: string; promptTokens: number; completionTokens: number };
        res.json(buildResponse(requestId, chatReq.model, cachedData.content, cachedData.promptTokens, cachedData.completionTokens));

        void logRequest(redis, {
          requestId, ts: new Date().toISOString(), apiKeyId, provider: 'cache', model: chatReq.model,
          cacheHit: true, statusCode: 200, errorType: null,
          totalLatencyMs: overhead, gatewayOverheadMs: overhead,
          retryMs: 0,
          promptTokens: cachedData.promptTokens, completionTokens: cachedData.completionTokens,
        });
        return;
      }
    }

    // Provider call with coalescing
    let providerResult: ProviderResponse & { failoverCount: number; totalProviderMs: number; retryMs: number };
    let providerName = 'unknown';
    let errorType: string | null = null;

    try {
      if (cacheable) {
        // Coalesce concurrent identical misses
        let pending = coalescing.get(cacheKey);
        if (!pending) {
          pending = callWithFailover(balancer, chatReq, (name) => { providerName = name; });
          coalescing.set(cacheKey, pending);
          const cleanup = () => { coalescing.delete(cacheKey); };
          pending.then(cleanup, cleanup);
        } else {
          // Another request is already fetching — wait for it
          logger.debug({ cacheKey }, 'Coalescing request');
        }
        providerResult = await pending;
      } else {
        providerResult = await callWithFailover(balancer, chatReq, (name) => { providerName = name; });
      }

      if (cacheable) {
        await setInCache(redis, cacheKey, JSON.stringify({
          content: providerResult.content,
          promptTokens: providerResult.promptTokens,
          completionTokens: providerResult.completionTokens,
        }));
      }
    } catch (err: unknown) {
      errorType = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
      const errWithStats = err as { totalProviderMs?: number; retryMs?: number };
      const totalProviderMs = errWithStats.totalProviderMs ?? 0;
      const retryMs = errWithStats.retryMs ?? 0;
      const totalMs = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
      const overhead = Math.max(0, Math.round(totalMs - totalProviderMs));
      res.setHeader('X-Cache', 'MISS');
      res.setHeader('X-Gateway-Overhead-Ms', String(overhead));
      res.setHeader('X-Retry-Ms', String(retryMs));
      res.status(502).json({ error: 'All providers failed', details: errorType });

      void logRequest(redis, {
        requestId, ts: new Date().toISOString(), apiKeyId, provider: providerName, model: chatReq.model,
        cacheHit: false, statusCode: 502, errorType,
        totalLatencyMs: Math.round(totalMs), gatewayOverheadMs: overhead,
        retryMs,
        promptTokens: 0, completionTokens: 0,
      });
      return;
    }

    const totalMs = Number(process.hrtime.bigint() - totalStart) / 1_000_000;
    const gatewayOverhead = Math.max(0, Math.round(totalMs - providerResult.totalProviderMs));
    const retryMs = providerResult.retryMs;

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('X-Provider', providerName);
    res.setHeader('X-Gateway-Overhead-Ms', String(gatewayOverhead));
    res.setHeader('X-Retry-Ms', String(retryMs));
    res.setHeader('X-Failovers', String(providerResult.failoverCount));
    res.json(buildResponse(requestId, chatReq.model, providerResult.content, providerResult.promptTokens, providerResult.completionTokens));

    void logRequest(redis, {
      requestId, ts: new Date().toISOString(), apiKeyId, provider: providerName, model: chatReq.model,
      cacheHit: false, statusCode: 200, errorType: null,
      totalLatencyMs: Math.round(totalMs), gatewayOverheadMs: gatewayOverhead,
      retryMs,
      promptTokens: providerResult.promptTokens, completionTokens: providerResult.completionTokens,
    });
  });

  return router;
}

async function callWithFailover(
  balancer: LoadBalancer,
  chatReq: ChatRequest,
  onProvider: (name: string) => void
): Promise<ProviderResponse & { failoverCount: number; totalProviderMs: number; retryMs: number }> {
  const excluded = new Set<string>();
  let lastErr: Error | null = null;
  let failoverCount = 0;
  let totalProviderMs = 0;
  let retryMs = 0;

  for (let attempt = 0; attempt <= 2; attempt++) {
    const provider = balancer.select(excluded);
    if (!provider) break;

    const breaker = balancer.getBreaker(provider.name);
    breaker.incrementInflight();
    onProvider(provider.name);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const attemptStart = process.hrtime.bigint();

    try {
      const result = await provider.chat(chatReq, controller.signal);
      clearTimeout(timeout);
      const attemptDuration = Number(process.hrtime.bigint() - attemptStart) / 1_000_000;
      const callMs = result.latencyMs || Math.round(attemptDuration);
      totalProviderMs += callMs;
      balancer.recordSuccess(provider.name, result.latencyMs);
      return { ...result, failoverCount, totalProviderMs, retryMs };
    } catch (err) {
      clearTimeout(timeout);
      const attemptDuration = Number(process.hrtime.bigint() - attemptStart) / 1_000_000;
      const callMs = Math.round(attemptDuration);
      totalProviderMs += callMs;
      retryMs += callMs;
      failoverCount++;
      balancer.recordFailure(provider.name);
      excluded.add(provider.name);
      lastErr = err instanceof Error ? err : new Error(String(err));
      logger.warn({ provider: provider.name, err: lastErr.message, attempt, callMs }, 'Provider call failed, trying next');
    }
  }

  throw Object.assign(lastErr ?? new Error('No providers available'), { totalProviderMs, retryMs, failoverCount });
}

function buildResponse(
  requestId: string,
  model: string,
  content: string,
  promptTokens: number,
  completionTokens: number
) {
  return {
    id: `chatcmpl-${requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}

async function logRequest(redis: Redis, event: LogEvent): Promise<void> {
  try {
    await redis.xadd(
      'requests:log',
      'MAXLEN', '~', '100000',
      '*',
      'd', JSON.stringify(event)
    );
  } catch (err) {
    logger.warn({ err }, 'Failed to log request to Redis stream');
  }
}
