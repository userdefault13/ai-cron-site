#!/usr/bin/env bash
# Launches cron402-mcp with the agent key pulled from the abracadabra vault.
# No plaintext key is ever stored in a config file — Touch ID gates each start.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${CRON402_ABRA_PROJECT:-ai-cron-site}"

if [[ -z "${CRON402_PRIVATE_KEY:-}" ]]; then
  KEY=$(abra get "$PROJECT" EVM_PRIVATE_KEY)
  export CRON402_PRIVATE_KEY="$KEY"
fi
export CRON402_NETWORK="${CRON402_NETWORK:-eip155:84532}"
export CRON402_API_URL="${CRON402_API_URL:-https://cron402-api.user-defaults.workers.dev}"

exec node "$DIR/dist/index.js"
