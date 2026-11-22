import { createHash } from 'crypto';
import type Redis from 'ioredis';
import type { ChatRequest } from '@ai-gateway/shared';
import { logger } from './logger';

const CACHE_TTL = 3600;

export function buildCacheKey(req: ChatRequest): string {
  const payload = JSON.stringify({
    model: req.model,
    messages: req.messages,
    temperature: req.temperature ?? 0,
    max_tokens: req.max_tokens,
  });
  const hash = createHash('sha256').update(payload).digest('hex');
  return `cache:${hash}`;
}

export function isCacheable(req: ChatRequest): boolean {
  return req.temperature === undefined || req.temperature === 0;
}

export async function getFromCache(redis: Redis, key: string): Promise<string | null> {
  try {
    return await redis.get(key);
  } catch (err) {
    logger.warn({ err }, 'Cache GET failed');
    return null;
  }
}

export async function setInCache(redis: Redis, key: string, value: string): Promise<void> {
  try {
    await redis.set(key, value, 'EX', CACHE_TTL);
  } catch (err) {
    logger.warn({ err }, 'Cache SET failed');
  }
}
