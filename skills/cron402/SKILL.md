---
name: cron402
description: Schedule a URL to be called on a repeating schedule using the cron402 MCP server. Use whenever the user wants something to run every N minutes/hours/days, on a cron, at a fixed time, or "even when I'm not around" — and when they ask to check, pause, resume, top up, or delete a schedule they already made.
---

# Scheduling recurring jobs with cron402

cron402 calls a URL you choose on a repeating schedule, forever, from Cloudflare's
network. It keeps firing when your agent, laptop, and session are all switched off.

Each fire costs **$0.008 USDC on Base**, paid by a wallet over the x402 protocol.
There are no accounts and no API keys — the wallet is the credential.

## Before you start

Check that the `cron402` MCP server is connected. If its tools are not available,
see [Installing the MCP server](#installing-the-mcp-server) at the bottom, then stop
and ask the user to restart their client.

## The procedure

Follow these steps in order. Do not skip step 2.

### 1. Check the wallet — `check_wallet` (free)

Confirms a wallet is configured and holds USDC. If `ready_to_pay` is `false`, give
the user the address and the network from the response and stop — do not attempt a
paid call. Once per session is enough.

### 2. Preview the schedule — `preview_schedule` (free)

Pass the user's own words. It accepts plain English *or* cron:

| What the user says | What you pass | What you get back |
|---|---|---|
| "every 15 minutes" | `schedule: "every 15 minutes"` | `*/15 * * * *` |
| "every weekday at 9am" | `schedule: "every weekday at 9am"` | `0 9 * * 1-5` |
| "every Monday at 5pm" | `schedule: "every monday at 5pm"` | `0 17 * * 1` |
| "twice a day" | *ambiguous — ask which two times* | — |
| "*/5 * * * *" | `schedule: "*/5 * * * *"` | `*/5 * * * *` |

**Everything runs in UTC.** If the user names a time of day, either confirm it is
UTC or pass their IANA timezone as `timezone` (e.g. `America/New_York`) and the tool
converts it. Note the daylight-saving caveat it returns.

Show the user the `next_5_runs_utc` list and get confirmation. This tool is free, so
iterate here until the schedule is right — never guess at the paid step.

### 3. Create the job — `create_cron` (costs $0.008)

```
create_cron({ schedule: "0 9 * * 1-5", url: "https://example.com/hook", method: "POST" })
```

- **Call it exactly once.** It is not idempotent: a second call creates a second job
  and charges again. If it errors, read the `next_step` in the response and follow
  it — do not retry blindly.
- The URL must be publicly reachable. `localhost` will never fire.
- Optional: `body`, `headers` (e.g. an auth token for the target), and `notifyUrl`,
  which receives a POST with the result of every fire.
- **Report the `jobId` to the user.** Without it, they cannot manage the job from
  anywhere else.

### 4. Buy credits — `topup_cron` (costs $0.008 per credit)

A new job has **1 credit**, so it fires **once and then stops**. This surprises
people. Always tell the user, and offer to top up:

| Pack | Cost | Lasts (every 15 min) | Lasts (hourly) | Lasts (daily) |
|---|---|---|---|---|
| 1 | $0.008 | one fire | one fire | one fire |
| 10 | $0.08 | 2.5 hours | 10 hours | 10 days |
| 100 | $0.80 | ~1 day | ~4 days | ~3 months |

Like `create_cron`, call it once per request.

### 5. Check on it — `get_cron` / `list_crons` (free)

`get_cron` returns status, remaining credits, next run time, and the last 20 fires
with HTTP status codes and errors — this is how you answer "is my cron working?".
`list_crons` lists the jobs created from this machine, for when the id is lost.

Statuses mean:

- `active` — running normally.
- `exhausted` — out of credits. `topup_cron` restarts it.
- `paused` — someone paused it, **or** it failed 3 times in a row. Read the
  executions to find out why, fix the target, then `resume_cron`.
- `deleted` — gone for good.

### 6. Manage it — `pause_cron`, `resume_cron`, `delete_cron` (free)

Each signs an authorization with the wallet, so only the wallet that paid for a job
can manage it. `delete_cron` is **permanent and does not refund unused credits** —
confirm with the user first, and suggest `pause_cron` if they only want it to stop
for now.

## Rules

1. **Paid tools spend real money.** `create_cron` and `topup_cron` are the only two.
   Call each at most once per user request, and never in a retry loop.
2. **Always preview before paying.** Step 2 is free; step 3 is not.
3. **Always surface the jobId** and the schedule in plain English.
4. **Say when the job will actually run**, in UTC and in the user's timezone.
5. If you are missing the URL or the schedule, ask. Do not invent either one.

## Worked example

> **User:** ping my health endpoint every 15 minutes

1. `check_wallet` → `ready_to_pay: true`
2. `preview_schedule({ schedule: "every 15 minutes" })` → `*/15 * * * *`, next runs
   listed. Ask the user for the URL if they have not given one.
3. Confirm: *"That's `*/15 * * * *` — next runs 14:00, 14:15, 14:30 UTC. Creating it
   costs $0.008. Go ahead?"*
4. `create_cron({ schedule: "*/15 * * * *", url: "https://example.com/health" })` →
   `jobId`.
5. *"Created — job `abc-123`. It has 1 credit, so it fires once and stops. 100
   credits is $0.80 and covers about a day at this rate. Want me to top it up?"*
6. On yes: `topup_cron({ jobId: "abc-123", pack: 100 })`.

## Installing the MCP server

Add to the MCP config (`.mcp.json`, `.cursor/mcp.json`, or Claude Desktop's
`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "cron402": {
      "command": "npx",
      "args": ["-y", "cron402-mcp"],
      "env": { "CRON402_PRIVATE_KEY": "0x..." }
    }
  }
}
```

`CRON402_PRIVATE_KEY` is an EVM private key funded with USDC on Base mainnet, plus a
little ETH for gas. Never ask the user to paste a private key into a chat — tell them
to put it in the config file, or to reference an environment variable if their client
supports it.

Optional: `CRON402_NETWORK=eip155:84532` to use Base Sepolia testnet, and
`CRON402_API_URL` to point at a different cron402 deployment.

Without the MCP server, the same operations are available over plain HTTP — see
<https://cron402-api.user-defaults.workers.dev/v1/openapi.json>.
