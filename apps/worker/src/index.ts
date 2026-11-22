import Redis from 'ioredis';
import { Pool } from 'pg';
import pino from 'pino';
import type { LogEvent, MetricsSnapshot } from '@ai-gateway/shared';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
const redisPub = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
const db = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://gateway:gateway@localhost:5432/gateway',
  max: 5,
});

const GROUP = 'workers';
const CONSUMER = `w-${process.pid}`;
const STREAM = 'requests:log';

async function ensureGroup(): Promise<void> {
  try {
    await redis.xgroup('CREATE', STREAM, GROUP, '$', 'MKSTREAM');
    logger.info('Created consumer group');
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('BUSYGROUP')) {
      logger.info('Consumer group already exists');
      return;
    }
    throw err;
  }
}

let lastTrafficTime = 0;

async function processEntries(entries: Array<[string, string[]]>): Promise<void> {
  if (entries.length === 0) return;

  const events: LogEvent[] = [];
  const ids: string[] = [];

  for (const [id, fields] of entries) {
    ids.push(id);
    const dIndex = fields.indexOf('d');
    if (dIndex === -1 || !fields[dIndex + 1]) {
      logger.warn({ id }, 'Missing data field in entry');
      continue;
    }
    try {
      events.push(JSON.parse(fields[dIndex + 1]!) as LogEvent);
    } catch {
      logger.warn({ id }, 'Failed to parse log entry JSON');
    }
  }

  if (events.length > 0) {
    lastTrafficTime = Date.now();
    await bulkInsert(events);
    await upsertRollups(events);
    const snapshot = buildSnapshot(events);
    await publishMetrics(snapshot);
    logger.debug({ count: events.length }, 'Processed batch');
  }

  // ACK all (even unparseable ones — they won't be retried)
  if (ids.length > 0) {
    await redis.xack(STREAM, GROUP, ...ids);
  }
}

async function bulkInsert(events: LogEvent[]): Promise<void> {
  const ts = events.map((e) => e.ts);
  const requestIds = events.map((e) => e.requestId);
  const apiKeyIds = events.map((e) => e.apiKeyId);
  const providers = events.map((e) => e.provider);
  const models = events.map((e) => e.model);
  const cacheHits = events.map((e) => e.cacheHit);
  const statusCodes = events.map((e) => e.statusCode);
  const errorTypes = events.map((e) => e.errorType);
  const totalLatencies = events.map((e) => e.totalLatencyMs);
  const gatewayOverheads = events.map((e) => e.gatewayOverheadMs);
  const retryMsList = events.map((e) => e.retryMs ?? 0);
  const promptTokens = events.map((e) => e.promptTokens);
  const completionTokens = events.map((e) => e.completionTokens);

  await db.query(
    `INSERT INTO request_logs
      (ts, request_id, api_key_id, provider, model, cache_hit, status_code, error_type,
       total_latency_ms, gateway_overhead_ms, retry_ms, prompt_tokens, completion_tokens)
     SELECT * FROM UNNEST(
       $1::timestamptz[], $2::uuid[], $3::int[], $4::text[], $5::text[],
       $6::boolean[], $7::int[], $8::text[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[]
     )`,
    [ts, requestIds, apiKeyIds, providers, models, cacheHits, statusCodes, errorTypes, totalLatencies, gatewayOverheads, retryMsList, promptTokens, completionTokens]
  );
}

async function upsertRollups(events: LogEvent[]): Promise<void> {
  const rollups = new Map<
    string,
    { requests: number; errors: number; cacheHits: number; promptTokens: number; completionTokens: number }
  >();

  for (const e of events) {
    const minute = new Date(Math.floor(new Date(e.ts).getTime() / 60_000) * 60_000).toISOString();
    const provider = e.provider ?? 'unknown';
    const k = `${minute}:::${provider}`;
    const r = rollups.get(k) ?? { requests: 0, errors: 0, cacheHits: 0, promptTokens: 0, completionTokens: 0 };
    r.requests++;
    if (e.statusCode >= 400) r.errors++;
    if (e.cacheHit) r.cacheHits++;
    r.promptTokens += e.promptTokens;
    r.completionTokens += e.completionTokens;
    rollups.set(k, r);
  }

  for (const [k, v] of rollups) {
    const [minute, provider] = k.split(':::') as [string, string];
    await db.query(
      `INSERT INTO provider_stats_1m (minute, provider, requests, errors, cache_hits, prompt_tokens, completion_tokens)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (minute, provider) DO UPDATE SET
         requests = provider_stats_1m.requests + EXCLUDED.requests,
         errors = provider_stats_1m.errors + EXCLUDED.errors,
         cache_hits = provider_stats_1m.cache_hits + EXCLUDED.cache_hits,
         prompt_tokens = provider_stats_1m.prompt_tokens + EXCLUDED.prompt_tokens,
         completion_tokens = provider_stats_1m.completion_tokens + EXCLUDED.completion_tokens`,
      [minute, provider, v.requests, v.errors, v.cacheHits, v.promptTokens, v.completionTokens]
    );
  }
}

function buildSnapshot(events: LogEvent[]): MetricsSnapshot {
  const latencies = events.map((e) => e.gatewayOverheadMs).sort((a, b) => a - b);
  const pct = (p: number) => latencies[Math.floor((latencies.length - 1) * p)] ?? 0;

  const byProvider: MetricsSnapshot['byProvider'] = {};
  for (const e of events) {
    const prov = e.provider ?? 'unknown';
    const r = byProvider[prov] ?? { requests: 0, errors: 0, cacheHits: 0 };
    r.requests++;
    if (e.statusCode >= 400) r.errors++;
    if (e.cacheHit) r.cacheHits++;
    byProvider[prov] = r;
  }

  return {
    ts: new Date().toISOString(),
    requests: events.length,
    errors: events.filter((e) => e.statusCode >= 400).length,
    cacheHits: events.filter((e) => e.cacheHit).length,
    promptTokens: events.reduce((s, e) => s + e.promptTokens, 0),
    completionTokens: events.reduce((s, e) => s + e.completionTokens, 0),
    p50: pct(0.5),
    p95: pct(0.95),
    p99: pct(0.99),
    byProvider,
  };
}

async function publishMetrics(snapshot: MetricsSnapshot): Promise<void> {
  try {
    const json = JSON.stringify(snapshot);
    await redisPub.publish('metrics:live', json);
    await redisPub.lpush('metrics:recent', json);
    await redisPub.ltrim('metrics:recent', 0, 299);
  } catch (err) {
    logger.warn({ err }, 'Failed to publish metrics');
  }
}

async function autoClaim(): Promise<void> {
  try {
    // XAUTOCLAIM: reclaim entries idle > 30s
    const result = (await redis.xautoclaim(
      STREAM, GROUP, CONSUMER, 30_000, '0-0', 'COUNT', '100'
    )) as [string, Array<[string, string[]]>, string[]];
    const entries = result[1] ?? [];
    if (entries.length > 0) {
      logger.info({ count: entries.length }, 'Reclaimed idle entries via XAUTOCLAIM');
      await processEntries(entries);
    }
  } catch (err) {
    logger.warn({ err }, 'XAUTOCLAIM failed (may be unsupported Redis version)');
  }
}

// Zero-snapshot heartbeat: keeps charts alive only when idle
setInterval(async () => {
  if (Date.now() - lastTrafficTime < 1200) return;
  const snap: MetricsSnapshot = {
    ts: new Date().toISOString(),
    requests: 0, errors: 0, cacheHits: 0,
    promptTokens: 0, completionTokens: 0,
    p50: 0, p95: 0, p99: 0,
    byProvider: {},
  };
  await publishMetrics(snap).catch(() => undefined);
}, 1000);

// XAUTOCLAIM crash recovery every 30s
setInterval(() => { void autoClaim(); }, 30_000);

async function run(): Promise<void> {
  await ensureGroup();
  logger.info({ consumer: CONSUMER }, 'Worker started');

  while (true) {
    try {
      const results = (await redis.xreadgroup(
        'GROUP', GROUP, CONSUMER,
        'COUNT', '500',
        'BLOCK', '1000',
        'STREAMS', STREAM, '>'
      )) as Array<[string, Array<[string, string[]]>]> | null;

      if (!results) continue;

      for (const [, entries] of results) {
        await processEntries(entries);
      }
    } catch (err) {
      logger.error({ err }, 'Worker loop error');
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

run().catch((err) => {
  logger.error(err);
  process.exit(1);
});
