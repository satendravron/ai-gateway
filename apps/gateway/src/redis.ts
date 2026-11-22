import Redis from 'ioredis';
import { logger } from './logger';

export function createClient(): Redis {
  const client = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: false,
  });
  client.on('error', (err) => logger.warn({ err }, 'Redis error'));
  return client;
}
