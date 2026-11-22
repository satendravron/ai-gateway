import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';
import { Pool } from 'pg';
import pino from 'pino';
import { createHash, randomBytes } from 'crypto';
import type { MetricsSnapshot, ProviderStatus, WsMessage } from '@ai-gateway/shared';

const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  transport:
    process.env['NODE_ENV'] !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const PORT = parseInt(process.env['API_PORT'] ?? '4001', 10);
const redis = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
const redisSub = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379');
const db = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://gateway:gateway@localhost:5432/gateway',
  max: 5,
});

const app = express();
app.use(express.json());

// CORS for dashboard
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set<WebSocket>();

function broadcast(msg: WsMessage): void {
  const json = JSON.stringify(msg);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json);
      } catch (err) {
        logger.warn({ err }, 'WS send failed');
        clients.delete(client);
      }
    }
  }
}

wss.on('connection', async (ws) => {
  clients.add(ws);
  logger.debug({ clients: clients.size }, 'WS client connected');

  // Send hello with last 300 metrics points
  try {
    const recent = await redis.lrange('metrics:recent', 0, 299);
    const data = recent
      .map((s) => { try { return JSON.parse(s) as MetricsSnapshot; } catch { return null; } })
      .filter((x): x is MetricsSnapshot => x !== null)
      .reverse();
    const helloMsg: WsMessage = { type: 'hello', data };
    ws.send(JSON.stringify(helloMsg));
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch metrics:recent for hello');
  }

  ws.on('close', () => {
    clients.delete(ws);
    logger.debug({ clients: clients.size }, 'WS client disconnected');
  });

  ws.on('error', (err) => {
    logger.warn({ err }, 'WS client error');
    clients.delete(ws);
  });

  // Respond to pong
  ws.on('pong', () => { /* still alive */ });
});

// Heartbeat: ping all clients every 30s, drop dead ones
const pingInterval = setInterval(() => {
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.ping();
    } else {
      clients.delete(client);
    }
  }
}, 30_000);

wss.on('close', () => clearInterval(pingInterval));

// Subscribe to Redis pub/sub channels ONCE (not per client)
redisSub.subscribe('metrics:live', 'providers:state', (err) => {
  if (err) logger.error({ err }, 'Redis subscribe failed');
  else logger.info('Subscribed to metrics:live and providers:state');
});

let latestProviders: ProviderStatus[] = [];

redisSub.on('message', (channel: string, message: string) => {
  try {
    if (channel === 'metrics:live') {
      const data = JSON.parse(message) as MetricsSnapshot;
      broadcast({ type: 'metrics', data });
    } else if (channel === 'providers:state') {
      const data = JSON.parse(message) as ProviderStatus[];
      latestProviders = data;
      broadcast({ type: 'providers', data });
    }
  } catch (err) {
    logger.warn({ err, channel }, 'Failed to handle Redis message');
  }
});

// === REST Endpoints ===

app.get('/health', (_req, res) => res.json({ status: 'ok', clients: clients.size }));

app.get('/api/stats', (_req, res) => {
  res.json({
    providers: latestProviders,
  });
});

app.get('/api/summary', async (req, res) => {
  const range = req.query['range'] === '24h' ? 24 : 1;
  try {
    const result = await db.query(`
      SELECT
        COALESCE(SUM(requests), 0)::bigint AS total_requests,
        COALESCE(SUM(errors), 0)::bigint AS total_errors,
        COALESCE(SUM(cache_hits), 0)::bigint AS total_cache_hits,
        COALESCE(SUM(prompt_tokens), 0)::bigint AS total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0)::bigint AS total_completion_tokens
      FROM provider_stats_1m
      WHERE minute >= NOW() - INTERVAL '${range} hours'
    `);
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, 'Summary query failed');
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/timeseries', async (req, res) => {
  const range = req.query['range'] === '24h' ? 24 : 1;
  try {
    const result = await db.query(`
      SELECT
        date_trunc('minute', minute) AS ts,
        SUM(requests)::bigint AS requests,
        SUM(errors)::bigint AS errors,
        SUM(cache_hits)::bigint AS cache_hits,
        SUM(prompt_tokens)::bigint AS prompt_tokens,
        SUM(completion_tokens)::bigint AS completion_tokens
      FROM provider_stats_1m
      WHERE minute >= NOW() - INTERVAL '${range} hours'
      GROUP BY date_trunc('minute', minute)
      ORDER BY ts ASC
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Timeseries query failed');
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/providers', async (_req, res) => {
  try {
    const result = await db.query(`
      SELECT
        provider,
        SUM(requests)::bigint AS requests,
        SUM(errors)::bigint AS errors,
        SUM(cache_hits)::bigint AS cache_hits
      FROM provider_stats_1m
      WHERE minute >= NOW() - INTERVAL '1 hour'
      GROUP BY provider
      ORDER BY requests DESC
    `);
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Providers query failed');
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/api/logs', async (req, res) => {
  const limit = Math.min(parseInt(String(req.query['limit'] ?? '50'), 10), 200);
  const before = req.query['before'] ? parseInt(String(req.query['before']), 10) : null;
  try {
    const result = await db.query(
      `SELECT id, ts, request_id, provider, model, cache_hit, status_code, error_type,
              total_latency_ms, gateway_overhead_ms, retry_ms, prompt_tokens, completion_tokens
       FROM request_logs
       WHERE ($1::bigint IS NULL OR id < $1)
       ORDER BY id DESC LIMIT $2`,
      [before, limit]
    );
    res.json(result.rows);
  } catch (err) {
    logger.error({ err }, 'Logs query failed');
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/api/keys', async (req, res) => {
  const name = String(req.body.name ?? 'unnamed');
  const plaintext = `gw_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(plaintext).digest('hex');
  try {
    const result = await db.query<{ id: number }>(
      'INSERT INTO api_keys (name, key_hash) VALUES ($1, $2) RETURNING id',
      [name, hash]
    );
    res.json({ id: result.rows[0]!.id, name, key: plaintext });
  } catch (err) {
    logger.error({ err }, 'Create key failed');
    res.status(500).json({ error: 'Database error' });
  }
});

server.listen(PORT, () => {
  logger.info({ port: PORT }, 'API service listening');
});
