# cron402

x402-native **cron-as-a-service for AI agents**. Agents schedule webhook calls and pay per run in USDC on Base via the [x402 protocol](https://www.x402.org/) — no accounts, no API keys. The wallet *is* the credential.

- **Price:** $0.008 flat per run
- **Network:** Base mainnet (`eip155:8453`) — validated end-to-end on Sepolia first (settlement tx `0x01f7bed4…`)
- **Wallets:** built for Coinbase Agentic Wallets / any x402 client

---

## Architecture

```
┌────────────────────────────┐        ┌─────────────────────────────────────────┐
│  apps/web — SvelteKit      │        │  apps/api — Cloudflare Worker (Hono)    │
│  deployed to Vercel        │──────▶ │                                         │
│  - landing page            │        │  x402 paywall (@x402/hono v2)           │
│  - agent integration docs  │        │  ├─ POST /v1/crons            $0.008    │
│                            │        │  ├─ POST /v1/crons/topup/1|10|100       │
│                            │        │  ├─ GET  /v1/crons/:id        (free)    │
│                            │        │  ├─ POST /v1/crons/:id/pause|resume     │
│                            │        │  └─ DELETE /v1/crons/:id   (EIP-712)    │
└────────────────────────────┘        │                                         │
                                      │  CronJobDO (Durable Object per job)     │
                                      │  alarm() → dispatch webhook             │
                                      │  D1: jobs, executions, payments         │
                                      └─────────────────────────────────────────┘
                                                │ settle via facilitator
                                                ▼
                                         USDC on Base (Sepolia/mainnet)
```

### How scheduling works

- Every job gets its own **Durable Object** (`CronJobDO`). A `cron-parser`-computed next-run time is set as the DO's `alarm()` — exact to the minute for arbitrary cron expressions.
- Each fire: dispatch the target webhook (10s timeout) → up to 3 attempts with backoff → log the execution to D1 (kept: last 100 runs / 30 days per job) → consume 1 credit.
- Auto-pause rules: 3 consecutive failures → `paused`; zero credits → `exhausted`.
- A global Worker Cron Trigger (`* * * * *`) sweeps for missed alarms as a safety net.
- Top-ups reactivate `paused`/`exhausted` jobs automatically.

### How payments work

Paid endpoints are gated by [`@x402/hono`](https://www.npmjs.com/package/@x402/hono) v2 middleware:

1. Agent calls the endpoint with no auth.
2. Server responds `402 Payment Required` with instructions (price, network, `payTo`).
3. Agent signs an EIP-3009 USDC transfer from its wallet and retries.
4. The facilitator verifies + settles; settlement receipts land in D1.

Because the payer isn't online when an alarm fires, billing is **prepaid run credits**: creation includes 1 credit; packs of 1 / 10 / 100 cost $0.008 / $0.08 / $0.80. Credits never expire and top-ups are permissionless (anyone can fund any job).

Management actions (`pause`/`resume`/`delete`) require an EIP-712 signature over `ManageJob { action, jobId, timestamp }` from the payer key (±5 min validity).

---

## Repository layout

```
dev/ai-cron-site/
├── package.json               # pnpm workspaces + turbo tasks
├── turbo.json                 # build/check/lint pipeline
├── biome.json                 # Biome lint/format config
├── .env.example               # all env vars documented
├── packages/shared/
│   └── src/                   # zod schemas, constants, types, JSON Schemas
├── packages/mcp/
│   └── src/index.ts           # cron402-mcp: MCP server (6 agent tools)
└── apps/
    ├── api/                   # Cloudflare Worker
    │   ├── wrangler.jsonc     # DO bindings, D1 binding, cron trigger
    │   ├── .dev.vars.example  # local dev vars template
    │   ├── migrations/        # D1 schema (0001 init, 0002 notify_url)
    │   └── src/
    │       ├── index.ts       # Hono app, routes, lazy x402 middleware
    │       ├── scheduler.ts   # CronJobDO (alarm loop, retries, retention, notify)
    │       ├── auth.ts        # EIP-712 management-signature verification
    │       ├── payments.ts    # payer extraction from x402 headers
    │       ├── facilitator.ts # CDP hosted facilitator client
    │       ├── cdp-auth.ts    # CDP JWT signing (jose/WebCrypto)
    │       ├── openapi.ts     # OpenAPI 3.1 document builder
    │       └── types.ts       # Env bindings + typed DO stub interface
    └── web/                   # SvelteKit 5 → adapter-vercel (MS-DOS theme)
        └── src/routes/
            ├── +page.svelte          # landing
            ├── docs/+page.svelte     # agent integration guide
            ├── dashboard/+page.svelte # wallet-connected job console
            ├── llms.txt/+server.ts   # agent-readable site summary
            └── robots.txt/+server.ts # crawler policy (AI bots allowed)
```

## API reference

| Endpoint | Auth | Price | Description |
|---|---|---|---|
| `POST /v1/crons` | x402 | $0.008 | Create job (body: `{ schedule, target: { url, method?, headers?, body? }, maxRuns? }`). Includes 1 run credit. |
| `POST /v1/crons/topup/1` | x402 | $0.008 | Add 1 credit (body: `{ jobId }`) |
| `POST /v1/crons/topup/10` | x402 | $0.08 | Add 10 credits |
| `POST /v1/crons/topup/100` | x402 | $0.80 | Add 100 credits |
| `GET /v1/crons/:id` | free | — | Job status, credits, last 20 executions |
| `POST /v1/crons/:id/pause` | wallet-signed | — | Pause job |
| `POST /v1/crons/:id/resume` | wallet-signed | — | Resume job (requires credits) |
| `DELETE /v1/crons/:id` | wallet-signed | — | Delete job |
| `GET /health` | free | — | Liveness probe |
| `POST /v1/echo` | free | — | Test target for smoke tests |

Signed requests add two headers:
- `x-cron402-timestamp`: unix ms (valid ±5 min)
- `x-cron402-signature`: EIP-712 signature, domain `{ name: "cron402", version: "1" }`, primaryType `ManageJob`

### Limits & policies (v1)

- Min interval: 1 minute · Max 1,000 active jobs per payer wallet
- Retry policy: 3× with 1s/3s/8s backoff; non-retryable 4xx (except 429) fails immediately
- Log retention: last 100 executions or 30 days per job, whichever trims first

---

## Deployment status (live)

| Surface | URL |
|---|---|
| API (Cloudflare Workers) | https://cron402-api.user-defaults.workers.dev |
| Web (Vercel) | https://web-seven-ecru-65.vercel.app |
| OpenAPI spec | https://cron402-api.user-defaults.workers.dev/v1/openapi.json |
| Agent summary | https://web-seven-ecru-65.vercel.app/llms.txt |
| Job console | https://web-seven-ecru-65.vercel.app/dashboard |

Network: **Base mainnet** (`eip155:8453`) — flipped from Sepolia after a fully verified paid run. Receiving wallet secret `PAY_TO_ADDRESS` is set on the Worker. Facilitator: **Coinbase CDP hosted** (`CDP_API_KEY_ID`/`CDP_API_KEY_SECRET` secrets set; JWT auth implemented in `src/cdp-auth.ts`). D1 database `cron402` (id `b7e05d96-4737-4aa4-ab52-badcfacb3a22`) holds the schema from both migrations.

**Bazaar:** every 402 challenge carries `extensions.bazaar` with full input/output JSON Schemas, and the CDP facilitator advertises the bazaar extension — cron402 surfaces in CDP Bazaar discovery (`/platform/v2/x402/discovery/resources`) as agents transact through it.

### Execution webhooks

Pass optional `notifyUrl` when creating a job. After every fire, cron402 POSTs to it:

```json
{
  "type": "cron402.execution",
  "jobId": "…",
  "runAt": 1755000000000,
  "ok": true,
  "attempts": 1,
  "statusCode": 200,
  "error": null,
  "durationMs": 42
}
```

Notifications are best-effort (10s timeout, never affect scheduling).

### Human dashboard

`/dashboard` connects any injected EIP-1193 wallet (MetaMask etc.). Load a job by id to see status/credits/executions; pause/resume/delete request an `eth_signTypedData_v4` signature over `ManageJob` — exactly what agents sign, just through a browser wallet.

### MCP server (`cron402-mcp`)

Six tools for any MCP client: `create_cron`, `topup_cron`, `get_cron`, `pause_cron`, `resume_cron`, `delete_cron`. Paid calls flow through x402 automatically; management actions are signed locally.

```bash
# build from repo root
pnpm --filter cron402-mcp build

# run — key pulled from the abracadabra vault (project "ai-cron-site", Touch ID gated)
packages/mcp/abra-start.sh
```

Client config (opencode / Claude Desktop style):

```json
{
  "mcp": {
    "cron402": {
      "type": "local",
      "command": ["/path/to/ai-cron-site/packages/mcp/abra-start.sh"],
      "enabled": true
    }
  }
}
```

Env (optional overrides): `CRON402_NETWORK` (`eip155:8453` mainnet default, `eip155:84532` for Sepolia), `CRON402_API_URL`, `CRON402_ABRA_PROJECT` (default `ai-cron-site`). If `CRON402_PRIVATE_KEY` is already set in the environment, the vault lookup is skipped.

**Agent wallet:** `0x269B9678bEe6F5E4972C6e65522D763bA510d29f` — stored encrypted in the abracadabra vault as `ai-cron-site / EVM_PRIVATE_KEY`. On mainnet it needs **mainnet USDC** (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) + a little ETH for gas. This is the *payer*; revenue flows to the Worker's `PAY_TO_ADDRESS` secret.

---

## Local development

Prereqs: Node 22+, pnpm 9+, Wrangler (bundled).

```bash
pnpm install

# API — apply schema locally and start dev server (:8787)
pnpm --filter @cron402/api db:local
cp apps/api/.dev.vars.example apps/api/.dev.vars   # SKIP_PAYMENTS=1 by default
pnpm dev:api

# Web — SvelteKit dev server (:5173)
pnpm dev:web
```

With `SKIP_PAYMENTS=1` (local only), paid routes skip x402 verification and identify the payer via the `x-payer` header.

### E2E smoke test

```bash
# create an every-minute job targeting the built-in echo endpoint
curl -X POST http://127.0.0.1:8787/v1/crons \
  -H 'content-type: application/json' \
  -H 'x-payer: 0x1111111111111111111111111111111111111111' \
  -d '{"schedule":"* * * * *","target":{"url":"http://127.0.0.1:8787/v1/echo","method":"POST"}}'

# wait ~70s for the next minute boundary, then check the execution log
curl http://127.0.0.1:8787/v1/crons/<jobId>
# expect: credits decremented, executions[0].ok = 1, status flips to "exhausted" at 0 credits

# top up and watch it reactivate
curl -X POST http://127.0.0.1:8787/v1/crons/topup/10 \
  -H 'content-type: application/json' \
  -H 'x-payer: 0x1111111111111111111111111111111111111111' \
  -d '{"jobId":"<jobId>"}'
```

Quality gates: `pnpm lint` (Biome), `pnpm check` (tsc + svelte-check), `pnpm build`.

---

## Go-live instructions

### 1. Provision Cloudflare resources

```bash
cd apps/api
npx wrangler login

# create production D1 database and note the returned id
npx wrangler d1 create cron402
npx wrangler d1 execute cron402 --remote --file=migrations/0001_init.sql
```

Edit `apps/api/wrangler.jsonc`: replace the placeholder `database_id` with the real one.

> ⚠️ Durable Object class `CronJobDO` uses `new_sqlite_classes` — if you rename it or add classes later, bump the migration tag.

### 2. Set secrets & vars (API)

```bash
cd apps/api

# your receiving address on the chosen network (REQUIRED)
npx wrangler secret put PAY_TO_ADDRESS

# optional: CDP-hosted facilitator for production settlement
# default is the open https://x402.org/facilitator
npx wrangler secret put FACILITATOR_URL
```

Vars live in `wrangler.jsonc` / dashboard:

| Var | Values | Notes |
|---|---|---|
| `X402_NETWORK` | `eip155:84532` (sepolia) · `eip155:8453` (mainnet) | must match payTo network |
| `SKIP_PAYMENTS` | unset in prod! | only for local testing |
| `FACILITATOR_URL` | facilitator base URL | see below |

**Facilitator options**
- Default: `https://x402.org/facilitator` — open, no auth, testnet only.
- Production: **Coinbase CDP hosted facilitator** (recommended). Set secrets `CDP_API_KEY_ID` + `CDP_API_KEY_SECRET`; the Worker then automatically switches to `CdpFacilitatorClient` (`apps/api/src/facilitator.ts`), which generates a per-request CDP JWT bound to each endpoint (`/verify`, `/settle`, `/supported`) via the `uris` claim. JWT signing is implemented on `jose`/WebCrypto in `apps/api/src/cdp-auth.ts` and supports both Ed25519 and EC (ES256) CDP keys.
  - Get keys at <https://portal.cdp.coinbase.com> → API Keys → Secret API Key.
  - Optionally override `FACILITATOR_URL` if CDP exposes a different base path; default is `https://api.cdp.coinbase.com/platform/v2/x402`.

### 3. Deploy

```bash
# API
pnpm --filter @cron402/api deploy
curl https://cron402-api.<your-subdomain>.workers.dev/health

# Web (first time: vercel link inside apps/web)
cd apps/web && npx vercel --prod
# set PUBLIC_API_URL to the deployed Worker URL in Vercel project settings,
# then update the apiUrl constant in src/routes/docs/+page.svelte
```

### 4. Fund & verify end-to-end on Sepolia

1. Get free test USDC: <https://faucet.circle.com/> (Base Sepolia).
2. Run the buyer snippet from `/docs` on the site (uses `@x402/fetch` + Coinbase Agentic Wallet) pointed at your deployed Worker URL.
3. Confirm: `402 → sign → retry` succeeds, job appears, first fire lands within one minute, settlement logged in D1:

```bash
npx wrangler d1 execute cron402 --remote --command "SELECT * FROM payments ORDER BY created_at DESC LIMIT 5"
```

### 5. Mainnet flip checklist

- [ ] `PAY_TO_ADDRESS` is a mainnet-controlled address
- [ ] `X402_NETWORK=eip155:8453`
- [ ] Facilitator upgraded (CDP recommended; set spend controls on the payer side too)
- [ ] Re-test a full paid cycle before announcing
- [ ] Review rate limits / pricing in `packages/shared/src/index.ts` (`PRICE_PER_RUN_USD`, pack prices in `apps/api/src/index.ts` `TOPUP_PACKS`)

### Operational notes

- **Monitoring:** poll `GET /v1/crons/:id`; execution rows include status code, latency, error text.
- **Sweeper:** the every-minute Cron Trigger re-kicks DOs whose alarms were missed (>90s overdue). Check Worker metrics if jobs stall.
- **Changing price:** update `PRICE_PER_RUN_USD` in shared + `TOPUP_PACKS` in the API together.
- **Secrets hygiene:** `.dev.vars`, `.env*` are gitignored; never commit keys.
