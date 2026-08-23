import {
	createCronRequestJsonSchema,
	createCronResponseJsonSchema,
	errorResponseJsonSchema,
	executionViewJsonSchema,
	jobViewJsonSchema,
	MAX_ACTIVE_JOBS_PER_WALLET,
	PRICE_PER_RUN_USD,
	topupRequestJsonSchema,
	topupResponseJsonSchema,
} from "@cron402/shared";

const X402_402 = (description: string) => ({
	description: `${description} — 402 Payment Required with x402 instructions in the PAYMENT-REQUIRED header. Pay with any x402 client (e.g. @x402/fetch + a USDC wallet on Base) and retry the identical request.`,
	content: { "application/json": { schema: { type: "object" } } },
});

function jsonContent(schema: Record<string, unknown>) {
	return { "application/json": { schema } };
}

export function openApiDocument(baseUrl: string, network: string): Record<string, unknown> {
	return {
		openapi: "3.1.0",
		info: {
			title: "cron402 API",
			version: "0.1.0",
			description: `Cron-as-a-service for AI agents. Schedule webhook calls and pay per run in USDC on Base via the x402 protocol.

## Payment
Paid endpoints are x402 resources. Send an unauthenticated request; you receive \`402 Payment Required\` with payment instructions in the \`PAYMENT-REQUIRED\` header. Sign an EIP-3009 USDC transfer (${PRICE_PER_RUN_USD} USD per run unless noted) with any x402 client and retry the identical request.

## Management auth
pause/resume/delete require two headers signed by the payer key:
- \`x-cron402-timestamp\`: unix ms, valid ±5 minutes
- \`x-cron402-signature\`: EIP-712 signature over ManageJob { action, jobId, timestamp }, domain { name: "cron402", version: "1" }

## Limits
Min interval 1 minute · max ${MAX_ACTIVE_JOBS_PER_WALLET} active jobs per wallet · logs kept last 100 runs / 30 days.`,
			contact: { name: "cron402", url: "https://github.com/userdefault13/ai-cron-site" },
			license: { name: "MIT" },
		},
		servers: [{ url: baseUrl }],
		tags: [
			{ name: "jobs", description: "Create and inspect cron jobs" },
			{ name: "billing", description: "Prepaid run credits" },
			{ name: "management", description: "Wallet-signed job control" },
		],
		paths: {
			"/v1/crons": {
				post: {
					tags: ["jobs"],
					summary: "Create a cron job ($0.008, includes 1 run credit)",
					description:
						"Schedules a recurring webhook call. The target URL is called on schedule with up to 3 attempts per run.",
					requestBody: { required: true, content: jsonContent(createCronRequestJsonSchema) },
					responses: {
						201: {
							description: "Job created",
							content: jsonContent(createCronResponseJsonSchema),
						},
						400: {
							description: "Invalid request body or cron schedule",
							content: jsonContent(errorResponseJsonSchema),
						},
						429: {
							description: "Active job limit reached for payer wallet",
							content: jsonContent(errorResponseJsonSchema),
						},
						402: X402_402("Payment required to create a job"),
					},
				},
			},
			"/v1/crons/topup/{pack}": {
				post: {
					tags: ["billing"],
					summary: "Add prepaid run credits ($0.008 × pack size)",
					description:
						"Packs: 1 → $0.008, 10 → $0.08, 100 → $0.80. Permissionless: any wallet may fund any job. Reactivates exhausted/paused jobs.",
					parameters: [
						{
							name: "pack",
							in: "path",
							required: true,
							schema: { type: "string", enum: ["1", "10", "100"] },
						},
					],
					requestBody: { required: true, content: jsonContent(topupRequestJsonSchema) },
					responses: {
						200: { description: "Credits added", content: jsonContent(topupResponseJsonSchema) },
						400: {
							description: "jobId missing or malformed",
							content: jsonContent(errorResponseJsonSchema),
						},
						404: { description: "Job not found", content: jsonContent(errorResponseJsonSchema) },
						402: X402_402("Payment required for credit pack"),
					},
				},
			},
			"/v1/crons/{id}": {
				get: {
					tags: ["jobs"],
					summary: "Job status, credits, and last 20 executions (free)",
					parameters: [
						{
							name: "id",
							in: "path",
							required: true,
							schema: { type: "string", format: "uuid" },
						},
					],
					responses: {
						200: {
							description: "Job view with execution log",
							content: jsonContent({
								allOf: [jobViewJsonSchema, ...[]],
								properties: {
									executions: {
										type: "array",
										items: executionViewJsonSchema,
									},
								},
								required: [...((jobViewJsonSchema.required as string[]) ?? []), "executions"],
							}),
						},
						404: { description: "Job not found", content: jsonContent(errorResponseJsonSchema) },
					},
				},
				delete: {
					tags: ["management"],
					summary: "Delete a job (wallet-signed)",
					parameters: managementHeaders(),
					responses: {
						200: {
							description: "Job deleted",
							content: jsonContent({
								type: "object",
								properties: {
									ok: { type: "boolean" },
									id: { type: "string" },
									status: { const: "deleted" },
								},
							}),
						},
						401: unauthorized(),
						403: forbidden(),
						404: notFound(),
					},
				},
			},
			"/v1/crons/{id}/pause": {
				post: {
					tags: ["management"],
					summary: "Pause a job (wallet-signed)",
					parameters: managementHeaders("pause"),
					responses: {
						200: { description: "Job paused" },
						401: unauthorized(),
						403: forbidden(),
						404: notFound(),
					},
				},
			},
			"/v1/crons/{id}/resume": {
				post: {
					tags: ["management"],
					summary: "Resume a paused/exhausted job (wallet-signed, requires credits)",
					parameters: managementHeaders("resume"),
					responses: {
						200: { description: "Job active again" },
						400: {
							description: "No credits; top up first",
							content: jsonContent(errorResponseJsonSchema),
						},
						401: unauthorized(),
						403: forbidden(),
						404: notFound(),
					},
				},
			},
			"/health": {
				get: {
					tags: ["jobs"],
					summary: "Liveness probe (free)",
					responses: {
						200: {
							description: "Service healthy",
							content: jsonContent({
								type: "object",
								properties: {
									ok: { type: "boolean" },
									service: { const: "cron402-api" },
									version: { type: "string" },
								},
							}),
						},
					},
				},
			},
		},
		"x-402-network": network,
	};

	function managementHeaders(action?: string) {
		void action;
		return [
			{
				name: "id",
				in: "path",
				required: true,
				schema: { type: "string", format: "uuid" },
			},
			{
				name: "x-cron402-timestamp",
				in: "header",
				required: true,
				description: "Unix milliseconds; must be within ±5 minutes of server time",
				schema: { type: "integer" },
			},
			{
				name: "x-cron402-signature",
				in: "header",
				required: true,
				description:
					'EIP-712 signature from payer key over ManageJob { action, jobId, timestamp }, domain { name: "cron402", version: "1" }, primaryType "ManageJob"',
				schema: { type: "string" },
			},
		];
	}
}

function unauthorized() {
	return {
		description: "Missing signature headers",
		content: jsonContent(errorResponseJsonSchema),
	};
}
function forbidden() {
	return {
		description: "Invalid signature or wrong payer",
		content: jsonContent(errorResponseJsonSchema),
	};
}
function notFound() {
	return {
		description: "Job not found",
		content: jsonContent(errorResponseJsonSchema),
	};
}
