# abracadabra — secrets for this repo

This project's env vars live in the **abracadabra** vault (registered as an
MCP server in `opencode.json`). Never hardcode secrets or create `.env` files.

## Available MCP tools

| Tool | Use when | Returns |
|---|---|---|
| `list_projects` | discovering what vars exist | `{ projects: { "<name>": { "<KEY>": { secret } } } }` — key names only |
| `get_secrets` | you need actual values (e.g. to run/deploy the API) | Touch ID pops on the user's Mac → `{ approved: true, vars: { "<KEY>": "..." } }` |
| `generate_wallet` | a new EVM wallet is needed | stores address + private key in the vault, returns address only |

## How to request values

```
get_secrets({ "project": "ai-cron-site", "keys": ["CDP_API_KEY_ID", "CDP_API_KEY_SECRET"], "requestedBy": "ai-cron-site-agent" })
```

Parse: `JSON.parse(result.content[0].text)` → check `.approved === true`, read `.vars`.
On `isError: true`, read `.error` — do NOT retry in a loop; tell the user approval was denied.

Rules:
- Request only the keys you need, only when you need them.
- Never log, echo, or commit returned values.
- The user must approve each request via Touch ID — if denied, stop and ask.
- For running/starting services yourself, prefer telling the user:
  `abra run ai-cron-site -- <cmd>` injects everything automatically.
