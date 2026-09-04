#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { createPublicClient, formatEther, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";
import { z } from "zod";
import { nextRuns, parseSchedule } from "./schedule.js";
import { forgetJob, rememberedJobs, rememberJob, stateFilePath } from "./store.js";

const API_URL = (
	process.env.CRON402_API_URL ?? "https://cron402-api.user-defaults.workers.dev"
).replace(/\/$/, "");
const NETWORK = process.env.CRON402_NETWORK ?? "eip155:8453";
const PRIVATE_KEY = process.env.CRON402_PRIVATE_KEY;
const PRICE_PER_RUN_USD = 0.008;

const CHAINS = {
	"eip155:8453": {
		chain: base,
		name: "Base mainnet",
		usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	},
	"eip155:84532": {
		chain: baseSepolia,
		name: "Base Sepolia testnet",
		usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
	},
} as const;

const chainInfo = CHAINS[NETWORK as keyof typeof CHAINS];

// The wallet is optional at startup: without it the free tools (guide, schedule
// preview, job status) still work and the paid tools explain exactly what to set,
// which is far more useful to a model than a server that fails to start.
const account = PRIVATE_KEY ? privateKeyToAccount(PRIVATE_KEY as `0x${string}`) : null;
let paidFetch = globalThis.fetch;
if (account) {
	const client = new x402Client();
	registerExactEvmScheme(client, { signer: account });
	paidFetch = wrapFetchWithPayment(globalThis.fetch, client);
}

// ---------------------------------------------------------------- responses --

type ToolResponse = { content: [{ type: "text"; text: string }]; isError?: boolean };

function out(data: Record<string, unknown>): ToolResponse {
	return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function fail(error: string, next_step: string): ToolResponse {
	return {
		content: [{ type: "text", text: JSON.stringify({ ok: false, error, next_step }, null, 2) }],
		isError: true,
	};
}

const NO_WALLET = {
	error: "no wallet configured — CRON402_PRIVATE_KEY is not set",
	next_step:
		"Tell the user to add CRON402_PRIVATE_KEY (a funded EVM private key, 0x + 64 hex chars) to the cron402 entry in their MCP config and restart the MCP client. Do not ask them to paste the key into the chat.",
};

/** Turns low-level failures into something a small model can act on. */
function explain(err: unknown): ToolResponse {
	const message = err instanceof Error ? err.message : String(err);
	const lower = message.toLowerCase();
	if (
		lower.includes("insufficient") ||
		lower.includes("balance") ||
		lower.includes("transfer amount")
	)
		return fail(
			message,
			"The wallet is short on funds. Run check_wallet, then tell the user the address and that it needs USDC (and a little ETH for gas) on " +
				(chainInfo?.name ?? NETWORK) +
				". Do not retry until it is funded.",
		);
	if (lower.includes("402") || lower.includes("payment"))
		return fail(
			message,
			"Payment did not settle. Run check_wallet to confirm the balance and network, then try once more. If it fails again, report it to the user instead of retrying in a loop.",
		);
	if (lower.includes("fetch") || lower.includes("network") || lower.includes("econnrefused"))
		return fail(
			message,
			`Could not reach the cron402 API at ${API_URL}. Check connectivity and try once more; do not retry repeatedly.`,
		);
	return fail(
		message,
		"Report this error to the user verbatim. Do not retry the same call blindly.",
	);
}

/** Every tool body runs through this so a throw never reaches the model raw. */
function tool(handler: () => Promise<ToolResponse>): Promise<ToolResponse> {
	return handler().catch(explain);
}

// ------------------------------------------------------------------- helpers --

async function readJson(res: Response): Promise<Record<string, unknown>> {
	const text = await res.text();
	try {
		return JSON.parse(text) as Record<string, unknown>;
	} catch {
		return { error: text.slice(0, 500) || `HTTP ${res.status}` };
	}
}

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

async function manageHeaders(action: string, jobId: string) {
	if (!account) throw new Error(NO_WALLET.error);
	const timestamp = Date.now();
	const signature = await account.signTypedData({
		domain: { name: "cron402", version: "1" },
		types: {
			EIP712Domain: [
				{ name: "name", type: "string" },
				{ name: "version", type: "string" },
			],
			ManageJob: [
				{ name: "action", type: "string" },
				{ name: "jobId", type: "string" },
				{ name: "timestamp", type: "uint256" },
			],
		},
		primaryType: "ManageJob",
		message: { action, jobId, timestamp: BigInt(timestamp) },
	});
	return { "x-cron402-timestamp": String(timestamp), "x-cron402-signature": signature };
}

async function manage(action: "pause" | "resume" | "delete", jobId: string): Promise<ToolResponse> {
	if (!account) return fail(NO_WALLET.error, NO_WALLET.next_step);
	if (!UUID_RE.test(jobId))
		return fail(
			`"${jobId}" is not a job id`,
			"Job ids are UUIDs returned by create_cron. Call list_crons to see the jobs this wallet has created.",
		);
	const headers = await manageHeaders(action, jobId);
	const url =
		action === "delete" ? `${API_URL}/v1/crons/${jobId}` : `${API_URL}/v1/crons/${jobId}/${action}`;
	const res = await fetch(url, { method: action === "delete" ? "DELETE" : "POST", headers });
	const body = await readJson(res);
	if (!res.ok)
		return fail(
			`${action} failed: ${JSON.stringify(body)}`,
			res.status === 401 || res.status === 403
				? "Only the wallet that created the job can manage it. Confirm with the user that CRON402_PRIVATE_KEY is the same wallet that paid for this job."
				: "Report the error to the user.",
		);
	if (action === "delete") forgetJob(jobId);
	return out({
		ok: true,
		action,
		jobId,
		result: body,
		next_step:
			action === "delete"
				? "The job is gone. Unused credits are not refunded — tell the user."
				: `Call get_cron with jobId ${jobId} to confirm the new status.`,
	});
}

// --------------------------------------------------------------------- tools --

const server = new McpServer({ name: "cron402", version: "1.1.0" });

server.tool(
	"cron402_guide",
	"READ THIS FIRST before using any other cron402 tool. Free, no payment. Returns the exact step-by-step procedure for scheduling a recurring webhook, what each tool costs, and the rules you must follow.",
	{},
	async () =>
		out({
			ok: true,
			what_this_is:
				"cron402 calls a URL of your choice on a repeating schedule, forever, even while you are not running. You pay per fire in USDC on Base. There are no accounts or API keys — the wallet is the credential.",
			price: `$${PRICE_PER_RUN_USD} USDC per fire. Creating a job costs one fire ($${PRICE_PER_RUN_USD}) and includes 1 credit. When credits hit zero the job stops until someone tops it up.`,
			network: chainInfo?.name ?? NETWORK,
			wallet_configured: Boolean(account),
			procedure: [
				"1. check_wallet — confirm a wallet is configured and has USDC. Skip only if you already checked this session.",
				"2. preview_schedule — turn the user's words into a cron expression and SHOW THEM the next run times. Free. Never skip this.",
				"3. Ask the user to confirm the schedule and the target URL if you were not given both explicitly.",
				"4. create_cron — this SPENDS MONEY. Call it exactly once. It returns a jobId; report that jobId to the user.",
				"5. topup_cron — buy credits so the job keeps firing. A job created with 1 credit fires once and then stops.",
				"6. get_cron / list_crons — check status and execution history any time, free.",
			],
			rules: [
				"Never call create_cron or topup_cron more than once for the same request. They cost real money and are not idempotent — a repeat creates a second job or a second charge.",
				"If a paid tool errors, do NOT retry it blindly. Read the next_step in the error and follow it.",
				"All schedules run in UTC. If the user names a time, ask which timezone or pass the timezone argument.",
				"The target URL must be publicly reachable over HTTPS. localhost and 127.0.0.1 will never fire successfully.",
				"Always give the user the jobId. Without it they cannot manage the job from anywhere else.",
			],
			tools: {
				cron402_guide: "free — this document",
				check_wallet: "free — wallet address, network, USDC and ETH balance, runs affordable",
				preview_schedule: "free — validate a schedule and list the next run times",
				create_cron: `PAID $${PRICE_PER_RUN_USD} — create a job (includes 1 credit)`,
				topup_cron: `PAID $${PRICE_PER_RUN_USD}/credit — add 1, 10 or 100 credits`,
				get_cron: "free — status, credits, last 20 executions",
				list_crons: "free — jobs this machine created",
				pause_cron: "free — stop firing, keep credits",
				resume_cron: "free — start firing again",
				delete_cron: "free — permanent, credits are not refunded",
			},
		}),
);

server.tool(
	"check_wallet",
	"Free. Check the cron402 payment wallet before spending: returns the address, network, USDC balance, ETH balance for gas, and how many runs it can afford. Call this before create_cron or topup_cron.",
	{},
	() =>
		tool(async () => {
			if (!account)
				return out({
					ok: false,
					wallet_configured: false,
					network: chainInfo?.name ?? NETWORK,
					error: NO_WALLET.error,
					next_step: NO_WALLET.next_step,
				});
			if (!chainInfo)
				return out({
					ok: false,
					address: account.address,
					error: `CRON402_NETWORK is "${NETWORK}", which this server does not know how to read balances for`,
					next_step:
						"Set CRON402_NETWORK to eip155:8453 (Base mainnet) or eip155:84532 (Base Sepolia) in the MCP config.",
				});

			const publicClient = createPublicClient({ chain: chainInfo.chain, transport: http() });
			const [usdcRaw, ethRaw] = await Promise.all([
				publicClient.readContract({
					address: chainInfo.usdc,
					abi: [
						{
							name: "balanceOf",
							type: "function",
							stateMutability: "view",
							inputs: [{ name: "account", type: "address" }],
							outputs: [{ name: "", type: "uint256" }],
						},
					] as const,
					functionName: "balanceOf",
					args: [account.address],
				}),
				publicClient.getBalance({ address: account.address }),
			]);

			const usdc = Number(formatUnits(usdcRaw, 6));
			const runsAffordable = Math.floor(usdc / PRICE_PER_RUN_USD);
			const funded = runsAffordable >= 1;
			return out({
				ok: true,
				wallet_configured: true,
				address: account.address,
				network: chainInfo.name,
				usdc_balance: usdc.toFixed(6),
				eth_balance: formatEther(ethRaw),
				runs_affordable: runsAffordable,
				ready_to_pay: funded,
				next_step: funded
					? "The wallet can pay. Continue with preview_schedule, then create_cron."
					: `The wallet has no spendable USDC. Tell the user to send USDC to ${account.address} on ${chainInfo.name} (contract ${chainInfo.usdc}). Do not call create_cron until this shows ready_to_pay: true.`,
			});
		}),
);

server.tool(
	"preview_schedule",
	"Free, no payment. Turn a schedule into a validated cron expression and show the next 5 run times in UTC. Accepts plain English like 'every 15 minutes' or 'every weekday at 9am', or a 5-field cron expression. ALWAYS call this before create_cron and show the user the result.",
	{
		schedule: z
			.string()
			.describe(
				"Plain English ('every 15 minutes', 'every day at 09:00', 'every monday at 5pm', 'weekly') or a 5-field cron expression ('*/15 * * * *').",
			),
		timezone: z
			.string()
			.optional()
			.describe(
				"IANA timezone of any time-of-day in the schedule, e.g. 'America/New_York'. Omit if the user gave the time in UTC.",
			),
	},
	({ schedule, timezone }) =>
		tool(async () => {
			let parsed: ReturnType<typeof parseSchedule>;
			try {
				parsed = parseSchedule(schedule, timezone);
			} catch (err) {
				return fail(
					err instanceof Error ? err.message : String(err),
					"Rewrite the schedule using one of the listed phrases or a valid 5-field cron expression, then call preview_schedule again. This tool is free — iterate here rather than guessing at create_cron.",
				);
			}
			const runs = nextRuns(parsed.cron, 5);
			return out({
				ok: true,
				cron: parsed.cron,
				means: parsed.explanation,
				timezone_note: parsed.warning ?? "All cron402 schedules run in UTC.",
				next_5_runs_utc: runs,
				next_step: `Show the user these run times and confirm they are right. Then call create_cron with schedule "${parsed.cron}" — that call costs $${PRICE_PER_RUN_USD}.`,
			});
		}),
);

server.tool(
	"create_cron",
	`PAID: spends $${PRICE_PER_RUN_USD} USDC. Create a scheduled job that calls a webhook URL on a repeating schedule. Call this ONCE per request — calling it twice creates two jobs and charges twice. Run preview_schedule first. Returns a jobId you must report to the user. The job is created with 1 run credit, so it fires once and then stops unless you call topup_cron.`,
	{
		schedule: z
			.string()
			.describe(
				"Plain English ('every 15 minutes', 'every weekday at 9am') or a 5-field cron expression. Validated locally before any payment is made.",
			),
		url: z
			.string()
			.url()
			.describe("Public HTTPS URL to call on every fire. localhost will never work."),
		timezone: z
			.string()
			.optional()
			.describe("IANA timezone for a time-of-day in the schedule, e.g. 'Europe/Berlin'."),
		method: z.enum(["GET", "POST"]).optional().default("POST"),
		body: z.string().max(16384).optional().describe("Request body sent on every fire (POST only)."),
		headers: z
			.record(z.string())
			.optional()
			.describe("Extra request headers, e.g. an authorization token for the target."),
		notifyUrl: z
			.string()
			.url()
			.optional()
			.describe("Optional. Receives a POST with the result after every fire."),
	},
	({ schedule, url, timezone, method, body, headers, notifyUrl }) =>
		tool(async () => {
			if (!account) return fail(NO_WALLET.error, NO_WALLET.next_step);

			// Validate locally first — a bad schedule must never cost the user money.
			let parsed: ReturnType<typeof parseSchedule>;
			try {
				parsed = parseSchedule(schedule, timezone);
			} catch (err) {
				return fail(
					err instanceof Error ? err.message : String(err),
					"Nothing was charged. Fix the schedule and confirm it with preview_schedule (free) before calling create_cron again.",
				);
			}
			if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url))
				return fail(
					`"${url}" is not reachable from the internet`,
					"Nothing was charged. cron402 calls the URL from Cloudflare's network, so it must be public. Ask the user for a public HTTPS URL (a tunnel, a deployed endpoint, or a webhook service).",
				);

			const res = await paidFetch(`${API_URL}/v1/crons`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					schedule: parsed.cron,
					target: { url, method, headers, body },
					notifyUrl,
				}),
			});
			const result = await readJson(res);
			if (!res.ok)
				return fail(
					`create failed (HTTP ${res.status}): ${JSON.stringify(result)}`,
					"Report this to the user. Do not retry until you know why it failed — retrying may charge again.",
				);

			const jobId = String(result.id ?? "");
			if (jobId)
				rememberJob({
					jobId,
					schedule: parsed.cron,
					description: parsed.explanation,
					url,
					createdAt: new Date().toISOString(),
					network: NETWORK,
					apiUrl: API_URL,
				});

			return out({
				ok: true,
				jobId,
				schedule: parsed.cron,
				means: parsed.explanation,
				timezone_note: parsed.warning ?? "Runs in UTC.",
				credits: result.credits ?? 1,
				next_5_runs_utc: nextRuns(parsed.cron, 5),
				charged_usd: PRICE_PER_RUN_USD,
				next_step: `Tell the user the jobId (${jobId}) and that the job has 1 credit, so it fires ONCE and then stops. Ask whether to buy more credits with topup_cron (10 credits = $${(PRICE_PER_RUN_USD * 10).toFixed(2)}, 100 = $${(PRICE_PER_RUN_USD * 100).toFixed(2)}). Do not call create_cron again for this request.`,
			});
		}),
);

server.tool(
	"topup_cron",
	`PAID: spends $${PRICE_PER_RUN_USD} per credit ($${PRICE_PER_RUN_USD} / $${(PRICE_PER_RUN_USD * 10).toFixed(2)} / $${(PRICE_PER_RUN_USD * 100).toFixed(2)}). Add prepaid run credits to an existing job. Each credit pays for one fire. Also reactivates a job that ran out of credits. Call ONCE — repeating it charges again.`,
	{
		jobId: z.string().describe("The job id returned by create_cron."),
		pack: z
			.union([z.literal(1), z.literal(10), z.literal(100)])
			.describe("How many run credits to buy: 1, 10, or 100."),
	},
	({ jobId, pack }) =>
		tool(async () => {
			if (!account) return fail(NO_WALLET.error, NO_WALLET.next_step);
			if (!UUID_RE.test(jobId))
				return fail(
					`"${jobId}" is not a job id`,
					"Nothing was charged. Job ids are UUIDs from create_cron — call list_crons to find it.",
				);
			const res = await paidFetch(`${API_URL}/v1/crons/topup/${pack}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ jobId }),
			});
			const result = await readJson(res);
			if (!res.ok)
				return fail(
					`top-up failed (HTTP ${res.status}): ${JSON.stringify(result)}`,
					"Report this to the user. Do not retry until you know why it failed — retrying may charge again.",
				);
			return out({
				ok: true,
				jobId,
				credits_added: pack,
				charged_usd: Number((PRICE_PER_RUN_USD * pack).toFixed(3)),
				result,
				next_step: `Tell the user the job now has ${result.credits ?? `${pack} more`} credits. Do not call topup_cron again for this request.`,
			});
		}),
);

server.tool(
	"get_cron",
	"Free. Get one job's current status, remaining credits, next run time, and its last 20 executions with HTTP status codes and errors. Use this to answer 'is my cron working?'.",
	{ jobId: z.string().describe("The job id returned by create_cron.") },
	({ jobId }) =>
		tool(async () => {
			if (!UUID_RE.test(jobId))
				return fail(
					`"${jobId}" is not a job id`,
					"Job ids are UUIDs from create_cron. Call list_crons to see known jobs.",
				);
			const res = await fetch(`${API_URL}/v1/crons/${jobId}`);
			const job = await readJson(res);
			if (res.status === 404)
				return fail(
					`no job with id ${jobId}`,
					"The job was deleted or the id is wrong. Call list_crons to see the jobs created from this machine.",
				);
			if (!res.ok)
				return fail(
					`lookup failed (HTTP ${res.status}): ${JSON.stringify(job)}`,
					"Report this to the user.",
				);

			const status = String(
				(job.job as Record<string, unknown> | undefined)?.status ?? job.status ?? "unknown",
			);
			const hint: Record<string, string> = {
				active: "The job is running normally.",
				paused:
					"The job is paused — either someone paused it or it failed 3 times in a row. Check the executions below for the errors, fix the target, then call resume_cron.",
				exhausted: "The job ran out of credits and stopped. Call topup_cron to start it again.",
				deleted: "This job was deleted and will never fire again.",
			};
			return out({
				ok: true,
				jobId,
				job,
				status_means: hint[status] ?? "Report the raw status to the user.",
				next_step:
					"Summarise the status, the remaining credits, and any recent failures for the user.",
			});
		}),
);

server.tool(
	"list_crons",
	"Free. List the cron jobs created from this machine with this wallet, with each one's live status and remaining credits. Use this when the user asks what is scheduled or you have lost a job id.",
	{},
	() =>
		tool(async () => {
			const known = rememberedJobs(API_URL);
			if (known.length === 0)
				return out({
					ok: true,
					jobs: [],
					note: `No jobs recorded in ${stateFilePath} for ${API_URL}. This file only tracks jobs created through this MCP server — a job created elsewhere still exists, it just is not listed here.`,
					next_step:
						"Tell the user nothing is scheduled from this machine. If they have a jobId from elsewhere, use get_cron with it.",
				});

			const jobs = await Promise.all(
				known.map(async (j) => {
					try {
						const res = await fetch(`${API_URL}/v1/crons/${j.jobId}`);
						const live = (await readJson(res)) as Record<string, unknown>;
						const detail = (live.job as Record<string, unknown> | undefined) ?? live;
						return {
							jobId: j.jobId,
							schedule: j.schedule,
							means: j.description,
							url: j.url,
							createdAt: j.createdAt,
							status: res.ok ? (detail.status ?? "unknown") : `lookup failed (${res.status})`,
							credits: res.ok ? (detail.credits ?? null) : null,
						};
					} catch {
						return { ...j, status: "unreachable", credits: null };
					}
				}),
			);
			return out({
				ok: true,
				count: jobs.length,
				jobs,
				next_step:
					"Summarise these for the user. Jobs with status 'exhausted' need topup_cron; 'paused' ones need their target fixed and then resume_cron.",
			});
		}),
);

server.tool(
	"pause_cron",
	"Free. Stop a job from firing without deleting it. Credits are kept. Signs an EIP-712 authorization with the configured wallet — only the wallet that paid for the job can do this.",
	{ jobId: z.string().describe("The job id returned by create_cron.") },
	({ jobId }) => tool(() => manage("pause", jobId)),
);

server.tool(
	"resume_cron",
	"Free. Start a paused job firing again. The job needs at least 1 credit — if it is 'exhausted', call topup_cron instead. Signs an EIP-712 authorization with the configured wallet.",
	{ jobId: z.string().describe("The job id returned by create_cron.") },
	({ jobId }) => tool(() => manage("resume", jobId)),
);

server.tool(
	"delete_cron",
	"Free but PERMANENT and irreversible: deletes a job forever and does not refund unused credits. Confirm with the user before calling. If they only want it to stop for now, use pause_cron instead.",
	{ jobId: z.string().describe("The job id returned by create_cron.") },
	({ jobId }) => tool(() => manage("delete", jobId)),
);

await server.connect(new StdioServerTransport());
console.error(
	account
		? `cron402-mcp ready — wallet ${account.address} on ${chainInfo?.name ?? NETWORK} → ${API_URL}`
		: `cron402-mcp ready in read-only mode — set CRON402_PRIVATE_KEY to enable paid tools (${chainInfo?.name ?? NETWORK} → ${API_URL})`,
);
