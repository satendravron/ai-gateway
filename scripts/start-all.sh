#!/bin/bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$ROOT_DIR/logs"

echo "Starting services from $ROOT_DIR..."

# Function to kill all children on exit
cleanup() {
  echo "Stopping all services..."
  kill $(jobs -p) 2>/dev/null
  exit 0
}
trap cleanup SIGINT SIGTERM EXIT

# 1. Start mock providers
PORT=3001 NAME=provider-a BASE_LATENCY_MS=120 JITTER_MS=30 ERROR_RATE=0.01 \
  node "$ROOT_DIR/apps/mock-providers/dist/index.js" > "$ROOT_DIR/logs/mock-a.log" 2>&1 &

PORT=3002 NAME=provider-b BASE_LATENCY_MS=200 JITTER_MS=50 ERROR_RATE=0.02 \
  node "$ROOT_DIR/apps/mock-providers/dist/index.js" > "$ROOT_DIR/logs/mock-b.log" 2>&1 &

PORT=3003 NAME=provider-c BASE_LATENCY_MS=350 JITTER_MS=80 ERROR_RATE=0.05 \
  node "$ROOT_DIR/apps/mock-providers/dist/index.js" > "$ROOT_DIR/logs/mock-c.log" 2>&1 &

# 2. Start gateway
GATEWAY_PORT=4000 \
REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway \
API_KEY_SALT=change-me-in-production \
PROVIDER_URLS=http://127.0.0.1:3001,http://127.0.0.1:3002,http://127.0.0.1:3003 \
  node "$ROOT_DIR/apps/gateway/dist/index.js" > "$ROOT_DIR/logs/gateway.log" 2>&1 &

# 3. Start worker
REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway \
  node "$ROOT_DIR/apps/worker/dist/index.js" > "$ROOT_DIR/logs/worker.log" 2>&1 &

# 4. Start API service
API_PORT=4001 \
REDIS_URL=redis://127.0.0.1:6379 \
DATABASE_URL=postgresql://gateway:gateway@127.0.0.1:5432/gateway \
  node "$ROOT_DIR/apps/api/dist/index.js" > "$ROOT_DIR/logs/api.log" 2>&1 &

echo "Waiting 3 seconds for initialization..."
sleep 3

echo "=== Health checks ==="
curl -s http://127.0.0.1:3001/health && echo " (Mock A 3001)"
curl -s http://127.0.0.1:3002/health && echo " (Mock B 3002)"
curl -s http://127.0.0.1:3003/health && echo " (Mock C 3003)"
curl -s http://127.0.0.1:4000/health && echo " (Gateway 4000)"
curl -s http://127.0.0.1:4001/health && echo " (API 4001)"
echo "All services running. Keeping alive..."

# Wait for background jobs
wait
