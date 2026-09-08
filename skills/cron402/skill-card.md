# cron402 — Skill Card

## Purpose

Operate cron402 / agentcron.site paid webhook jobs via the cron402 MCP server
(x402 micropayments in USDC on Base). Applies only when the user names cron402,
agentcron, or the cron402 MCP, or manages a job already created there — not for
reminders, local timers, or generic "run this later" requests. Agents follow
check_wallet → preview → create → topup → get/list → manage. Companion vault:
[abracadabra](https://clawhub.ai/userdefault13/skills/abracadabra).


## Stack

vault → (optional License/cartridge) → lockfile cron402-mcp via `abra run` → x402/treasury.

## Security posture

- **No plaintext keys in MCP config.**
- **Secrets via abracadabra only** (`abra run` / short-lived env). Never literal keys.
- **Lockfile-local MCP binary only:** install cron402-mcp@1.1.0, run
  `node ./node_modules/cron402-mcp/dist/index.js` (or local `.bin`). Never dynamic
  package download to start MCP with a wallet key.
- **Dedicated low-balance wallet** for cron402 spend.
- **Never paste** private keys / ABRA_KEY into chat.
- **Paid tools** require explicit confirmation; call once per request.
- **Delete erases** stored headers/body/notifyUrl/query from D1 + DO; rotate credentials at the target (erase ≠ revoke).
- **Abra License:** gated one-shot after vault OK if cartridge empty; never auto-buy.
  Concierge Access required to open Terminal mint:
  https://www.aarcadeghst.com/concierge/terminal

## Install

ClawHub: userdefault13/cron402 · MCP: lockfile-local cron402-mcp@1.1.0 via abracadabra.

Note: ClawHub publish strips local skill-card.md; the registry generates skill-card.md
after security analysis completes.

## Treasury pays (optional)

When funding/settling cron402 from the user’s abra treasury, prefer MCP
`request_treasury_payment` / `abra treasury pay` with Touch ID — never auto-spend.
Companion: https://clawhub.ai/userdefault13/skills/abracadabra
