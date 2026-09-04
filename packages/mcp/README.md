# cron402-mcp

MCP server for [cron402](https://web-seven-ecru-65.vercel.app) — schedule webhook calls and pay per run in USDC on Base via [x402](https://www.x402.org). No accounts, no API keys; your wallet is the credential.

Built so that **small models can drive it safely**: schedules can be written in plain
English, every schedule can be validated for free before a paid call, and every
response carries an explicit `next_step` telling the model what to do next.

**Price:** $0.008 USDC per run · **Network:** Base mainnet (`eip155:8453`)

## Quick start

```bash
export CRON402_PRIVATE_KEY=0x...   # fund with USDC on Base
npx -y cron402-mcp
```

Optional env vars:

| Variable | Default | Description |
|---|---|---|
| `CRON402_PRIVATE_KEY` | *(required for paid tools)* | Agent wallet private key. Without it the server still starts and the free tools work. |
| `CRON402_NETWORK` | `eip155:8453` | CAIP-2 id; use `eip155:84532` for Base Sepolia |
| `CRON402_API_URL` | production Worker | Override API base URL |
| `CRON402_STATE_DIR` | `~/.cron402` | Where created job ids are remembered for `list_crons` |

## MCP client config

**Cursor / Claude Desktop:**

```json
{
  "mcpServers": {
    "cron402": {
      "command": "npx",
      "args": ["-y", "cron402-mcp"],
      "env": {
        "CRON402_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

**OpenCode** (`opencode.json`):

```json
{
  "mcp": {
    "cron402": {
      "type": "local",
      "command": ["npx", "-y", "cron402-mcp"],
      "environment": {
        "CRON402_PRIVATE_KEY": "0x..."
      },
      "enabled": true
    }
  }
}
```

## Tools

| Tool | Cost | Description |
|---|---|---|
| `cron402_guide` | free | The whole procedure, prices and rules — the tool a model should read first |
| `check_wallet` | free | Address, network, USDC/ETH balance, and how many runs it can afford |
| `preview_schedule` | free | Validate a schedule and list the next 5 run times in UTC |
| `create_cron` | $0.008 | Create a scheduled webhook job (includes 1 run credit) |
| `topup_cron` | $0.008–$0.80 | Add 1, 10, or 100 prepaid run credits |
| `get_cron` | free | Job status, credits, last 20 executions |
| `list_crons` | free | Jobs created from this machine, with live status |
| `pause_cron` | free | Pause a job (EIP-712 signed) |
| `resume_cron` | free | Resume a paused job (requires credits) |
| `delete_cron` | free | Permanently delete a job (EIP-712 signed) |

Paid tools handle x402 payment automatically. Management tools sign locally with your key.

### Designed for weak models

- **Plain-English schedules.** `"every 15 minutes"`, `"every weekday at 9am"`,
  `"every monday at 5pm"`, `"weekly"` and raw cron all work. Ambiguous or
  impossible phrases (`"every 2 weeks"`, `"at teatime"`) fail loudly with a fix,
  rather than silently scheduling the wrong thing.
- **Timezones.** Pass `timezone: "America/New_York"` and the time-of-day is
  converted to the UTC cron the API stores, with a DST caveat in the response.
- **Free dry run.** `preview_schedule` shows the next 5 fire times before a cent is
  spent, and `create_cron` re-validates locally so a bad schedule never costs money.
- **Money guardrails.** Paid tools say `PAID` in their descriptions, name the exact
  amount, and every response tells the model not to call them twice.
- **Actionable errors.** Insufficient funds, unreachable API, an unowned job or a
  `localhost` target each come back as `{ ok: false, error, next_step }`.
- **Job memory.** Created job ids are written to `~/.cron402/jobs.json` so
  `list_crons` can recover them — the API has no list endpoint.
- **Starts without a key.** A missing `CRON402_PRIVATE_KEY` degrades to read-only
  instead of failing to boot, so the model can explain what is missing.

## Agent skill

A drop-in skill teaching an agent this whole workflow lives at
[`skills/cron402/SKILL.md`](https://github.com/userdefault13/ai-cron-site/blob/main/skills/cron402/SKILL.md):

```bash
mkdir -p .claude/skills/cron402
curl -sL https://raw.githubusercontent.com/userdefault13/ai-cron-site/main/skills/cron402/SKILL.md \
  -o .claude/skills/cron402/SKILL.md
```

## Links

- [Integration docs](https://web-seven-ecru-65.vercel.app/docs)
- [OpenAPI spec](https://cron402-api.user-defaults.workers.dev/v1/openapi.json)
- [Agent skill file](https://web-seven-ecru-65.vercel.app/skill.md)
- [Source](https://github.com/userdefault13/ai-cron-site)
- [MCP Registry](https://registry.modelcontextprotocol.io)

## License

MIT
