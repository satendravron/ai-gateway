import type Redis from 'ioredis';

export async function checkRateLimit(
  redis: Redis,
  keyId: number,
  limitPerMin: number
): Promise<{ allowed: boolean; retryAfterS: number }> {
  const bucket = Math.floor(Date.now() / 60_000);
  const redisKey = `rl:${keyId}:${bucket}`;

  const count = await redis.incr(redisKey);
  if (count === 1) {
    await redis.expire(redisKey, 70);
  }

  if (count > limitPerMin) {
    return { allowed: false, retryAfterS: Math.ceil(60 - (Date.now() % 60_000) / 1000) };
  }
  return { allowed: true, retryAfterS: 0 };
}
