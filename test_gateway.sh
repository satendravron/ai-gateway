#!/bin/bash
set -e

echo "=== Phase 1: Mock providers health ==="
curl -sf http://127.0.0.1:3001/health && echo " [OK provider-a]"
curl -sf http://127.0.0.1:3002/health && echo " [OK provider-b]"
curl -sf http://127.0.0.1:3003/health && echo " [OK provider-c]"

echo ""
echo "=== Phase 2: Gateway health ==="
curl -sf http://127.0.0.1:4000/health

echo ""
echo "=== Phase 2: First request (expect MISS) ==="
curl -si -X POST http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer gw_demo_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"hello acceptance test"}]}'

echo ""
echo "=== Phase 2: Second identical request (expect HIT) ==="
curl -si -X POST http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer gw_demo_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"hello acceptance test"}]}'

echo ""
echo "=== Phase 2: Auth failure (no key) ==="
curl -si -X POST http://127.0.0.1:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"test","messages":[{"role":"user","content":"hello"}]}'

echo ""
echo "=== Phase 6: API service ==="
curl -sf http://127.0.0.1:4001/health

echo ""
echo "=== Done ==="
