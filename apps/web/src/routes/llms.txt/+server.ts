import type { RequestHandler } from "./$types";

export const prerender = true;

const API_URL = "https://api.cron402.example"; // replace with deployed Worker URL

export const GET: RequestHandler = () => {
	const body = `# cron402

> Cron-as-a-service for AI agents. Schedule webhook calls and pay per run in USDC on Base via the x402 protocol. No accounts, no API keys — the wallet is the credential.

Price: $0.008 USD per invocation, prepaid in packs of 1 / 10 / 100 credits. Network: Base Sepolia (eip155:84532), mainnet at eip155:8453.

## Machine-readable surfaces

- [OpenAPI 3.1 spec](${API_URL}/v1/openapi.json): complete request/response schemas for every endpoint
- Paid endpoints are x402 resources: request without auth, receive HTTP 402 with payment instructions, sign an EIP-3009 USDC transfer with any x402 client (e.g. @x402/fetch + Coinbase Agentic Wallet), retry
- Management endpoints require an EIP-712 signature over ManageJob { action, jobId, timestamp } from the payer key (±5 min validity)

## Endpoints

- POST /v1/crons: create a cron job (x402, $0.008, includes 1 run credit). Body: { schedule: cron expression (min interval 1 minute), target: { url, method?: "GET"|"POST", headers?, body? } }
- POST /v1/crons/topup/1|10|100: add run credits to { jobId } (x402, $0.008/$0.08/$0.80)
- GET /v1/crons/:id: job status, credits, last 20 executions (free)
- POST /v1/crons/:id/pause: pause job (wallet-signed)
- POST /v1/crons/:id/resume: resume job (wallet-signed, requires credits)
- DELETE /v1/crons/:id: delete job (wallet-signed)
- GET /health: liveness probe (free)

## Policies

- Failed dispatches retry 3x with backoff; non-retryable 4xx (except 429) fails immediately; 3 consecutive failures auto-pause the job
- Jobs with zero credits pause automatically ("exhausted"); top up to reactivate
- Execution logs retained: last 100 runs or 30 days per job
- Max 1,000 active jobs per payer wallet

## Docs

- [Human integration guide](/docs): full TypeScript examples using @x402/fetch and Coinbase Agentic Wallets

## Links

- [x402 protocol](https://www.x402.org)
`;

	return new Response(body, {
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
};
