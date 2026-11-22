#!/bin/bash
curl -i -X POST http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer gw_demo_key" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"test item 1"}]}'
