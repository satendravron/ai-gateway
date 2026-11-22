#!/bin/bash
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for pidfile in "$ROOT_DIR/logs/"*.pid; do
  if [ -f "$pidfile" ]; then
    pid=$(cat "$pidfile")
    kill "$pid" 2>/dev/null && echo "Killed PID $pid ($pidfile)"
    rm -f "$pidfile"
  fi
done
