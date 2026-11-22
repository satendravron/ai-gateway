#!/bin/bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT_DIR/logs"

# Kill previous
pkill -9 -f "apps/mock-providers/dist/index.js" 2>/dev/null || true
pkill -9 -f "apps/gateway/dist/index.js" 2>/dev/null || true
pkill -9 -f "apps/worker/dist/index.js" 2>/dev/null || true
pkill -9 -f "apps/api/dist/index.js" 2>/dev/null || true
sleep 1

echo "Starting services with disown..."

PORT=3001 NAME=provider-a BASE_LATENCY_MS=120 JITTER_MS=30 ERROR_RATE=0.01 \
  nohup node "$ROOT_DIR/apps/mock-providers/dist/index.js" </dev/null > "$ROOT_DIR/logs/mock-a.log" 2>&1 &
disown $!

PORT=3002 NAME=provider-b BASE_LATENCY_MS=200 JITTER_MS=50 ERROR_RATE=0.02 \
  nohup node "$ROOT_DIR/apps/mock-providers/dist/index.js" </dev/null > "$ROOT_DIR/logs/mock-b.log" 2>&1 &
disown $!

PORT=3003 NAME=provider-c BASE_LATENCY_MS=350 JITTER_MS=80 ERROR_RATE=0.05 \
  nohup node "$ROOT_DIR/apps/mock-providers/dist/index.js" </dev/null > "$ROOT_DIR/logs/mock-c.log" 2>&1 &
disown $!

GATEWAY_PORT=4000 \
REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway \
API_KEY_SALT=change-me-in-production \
PROVIDER_URLS=http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003 \
  nohup node "$ROOT_DIR/apps/gateway/dist/index.js" </dev/null > "$ROOT_DIR/logs/gateway.log" 2>&1 &
disown $!

REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway \
  nohup node "$ROOT_DIR/apps/worker/dist/index.js" </dev/null > "$ROOT_DIR/logs/worker.log" 2>&1 &
disown $!

API_PORT=4001 \
REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway \
  nohup node "$ROOT_DIR/apps/api/dist/index.js" </dev/null > "$ROOT_DIR/logs/api.log" 2>&1 &
disown $!

sleep 4

echo "=== Health checks ==="
curl -s http://127.0.0.1:3001/health && echo " (Mock A)"
curl -s http://127.0.0.1:3002/health && echo " (Mock B)"
curl -s http://127.0.0.1:3003/health && echo " (Mock C)"
curl -s http://127.0.0.1:4000/health && echo " (Gateway)"
curl -s http://127.0.0.1:4001/health && echo " (API)"
