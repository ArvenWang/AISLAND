#!/bin/bash
# Starts the dev stack (API + Vite), waits for health, runs Playwright e2e,
# then tears the stack down. Requires LLM_API_KEY configured (real API).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
LOG="$(mktemp -t mvp2-e2e.XXXXXX)"
"$ROOT/node_modules/.bin/npm-run-all" --parallel dev:server dev:frontend >"$LOG" 2>&1 &
DEV_PID=$!
cleanup() {
  kill "$DEV_PID" 2>/dev/null || true
  wait "$DEV_PID" 2>/dev/null || true
}
trap cleanup EXIT

ok=0
for _ in $(seq 1 45); do
  if curl -sf http://localhost:8787/api/health >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "e2e: API server did not become healthy" >&2
  tail -40 "$LOG" >&2
  exit 1
fi

npx playwright test --config=playwright.config.ts "$@"
