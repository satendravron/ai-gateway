import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import type Redis from 'ioredis';
import type { Pool } from 'pg';
import { logger } from '../logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyId?: number;
      rateLimitPerMin?: number;
    }
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function authMiddleware(redis: Redis, db: Pool) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers['authorization'] ?? '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const key = authHeader.slice(7).trim();
    if (!key) {
      res.status(401).json({ error: 'Empty API key' });
      return;
    }

    const hash = sha256(key);
    const redisKey = `key:${hash}`;

    try {
      // Try Redis cache first
      const cached = await redis.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached) as { id: number; rateLimitPerMin: number };
        req.apiKeyId = parsed.id;
        req.rateLimitPerMin = parsed.rateLimitPerMin;
        next();
        return;
      }

      // Fallback to Postgres
      const result = await db.query<{ id: number; rate_limit_per_min: number }>(
        'SELECT id, rate_limit_per_min FROM api_keys WHERE key_hash = $1',
        [hash]
      );

      if (result.rows.length === 0) {
        res.status(401).json({ error: 'Invalid API key' });
        return;
      }

      const row = result.rows[0]!;
      req.apiKeyId = row.id;
      req.rateLimitPerMin = row.rate_limit_per_min;

      // Cache for 60 s
      await redis.set(
        redisKey,
        JSON.stringify({ id: row.id, rateLimitPerMin: row.rate_limit_per_min }),
        'EX',
        60
      );
      next();
    } catch (err) {
      logger.error({ err }, 'Auth middleware error');
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
