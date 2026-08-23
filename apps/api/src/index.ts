import {
	createCronRequestJsonSchema,
	createCronRequestSchema,
	createCronResponseJsonSchema,
	type JobDbRow,
	type JobView,
	MAX_ACTIVE_JOBS_PER_WALLET,
	PRICE_PER_RUN_USD,
	topupRequestJsonSchema,
	topupResponseJsonSchema,
} from "@cron402/shared";
import type { RoutesConfig } from "@x402/core/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import type { Context } from "hono";
import { Hono } from "hono";
import { parseManageHeaders, verifyManageSignature } from "./auth";
import { CdpFacilitatorClient } from "./facilitator";
import { openApiDocument } from "./openapi";
import { extractPayer, isHexAddress, normalizeAddress } from "./payments";
import { CronJobDO, nextRunFrom } from "./scheduler";
import type { CronJobDOStub, Env } from "./types";

export { CronJobDO };

const app = new Hono<{ Bindings: Env }>();

app.get("/v1/openapi.json", (c) =>
	c.json(openApiDocument(new URL(c.req.url).origin, c.env.X402_NETWORK || "eip155:84532")),
);

const TOPUP_PACKS = [
	{ path: "/v1/crons/topup/1", runs: 1, price: PRICE_PER_RUN_USD },
	{ path: "/v1/crons/topup/10", runs: 10, price: 0.08 },
	{ path: "/v1/crons/topup/100", runs: 100, price: 0.8 },
] as const;

function bazaarExtension(
	description: string,
	input: Record<string, unknown>,
	output: Record<string, unknown>,
) {
	return {
		bazaar: {
			description,
			input,
			output,
			mimeType: "application/json",
		},
	};
}

function routesConfig(env: Env): RoutesConfig {
	const network = (env.X402_NETWORK || "eip155:84532") as `${string}:${string}`;
	// biome-ignore lint/suspicious/noExplicitAny: partial route config assembled dynamically
	const routes: Record<string, any> = {
		"POST /v1/crons": {
			accepts: {
				scheme: "exact",
				price: `$${PRICE_PER_RUN_USD}`,
				network,
				payTo: env.PAY_TO_ADDRESS,
			},
			description:
				"cron402: create a cron job that calls your webhook on a schedule. $0.008 includes 1 run credit; each subsequent run costs 1 credit (top up at /v1/crons/topup/{pack}).",
			mimeType: "application/json",
			extensions: bazaarExtension(
				"Create a scheduled webhook job. Body: cron expression + target URL/method/headers/body. Returns { id } — poll /v1/crons/{id} for status and execution logs.",
				createCronRequestJsonSchema,
				createCronResponseJsonSchema,
			),
		},
	};
	for (const pack of TOPUP_PACKS) {
		routes[`POST ${pack.path}`] = {
			accepts: {
				scheme: "exact",
				price: `$${pack.price}`,
				network,
				payTo: env.PAY_TO_ADDRESS,
			},
			description: `cron402: add ${pack.runs} prepaid run credit${pack.runs > 1 ? "s" : ""} ($${pack.price}) to an existing job. Reactivates exhausted jobs.`,
			mimeType: "application/json",
			extensions: bazaarExtension(
				`Top up ${pack.runs} run credit${pack.runs > 1 ? "s" : ""} for job jobId.`,
				topupRequestJsonSchema,
				topupResponseJsonSchema,
			),
		};
	}
	return routes as RoutesConfig;
}

// Lazy x402 middleware: built per-request so it can read request-time bindings.
app.use("/v1/*", async (c, next) => {
	if (c.env.SKIP_PAYMENTS === "1") return next();
	const facilitator =
		c.env.CDP_API_KEY_ID && c.env.CDP_API_KEY_SECRET
			? new CdpFacilitatorClient({
					apiKeyId: c.env.CDP_API_KEY_ID,
					apiKeySecret: c.env.CDP_API_KEY_SECRET,
					baseUrl: c.env.FACILITATOR_URL,
				})
			: new HTTPFacilitatorClient({
					url: c.env.FACILITATOR_URL || "https://x402.org/facilitator",
				});
	const resourceServer = new x402ResourceServer(facilitator).register(
		(c.env.X402_NETWORK || "eip155:84532") as `${string}:${string}`,
		new ExactEvmScheme(),
	);
	return paymentMiddleware(routesConfig(c.env), resourceServer)(c, next);
});

app.get("/health", (c) => c.json({ ok: true, service: "cron402-api", version: "0.1.0" }));

// Test target for cron dispatches
app.post("/v1/echo", async (c) => {
	const body = await c.req.text().catch(() => "");
	return c.json({ ok: true, receivedAt: Date.now(), bytes: body.length });
});

function payerFromRequest(c: Context<{ Bindings: Env }>): string | null {
	const payer = extractPayer(c.req.raw.headers);
	if (payer) return payer;
	const fallback = c.req.header("x-payer");
	if (fallback && isHexAddress(fallback)) return normalizeAddress(fallback);
	return null;
}

function stubFor(env: Env, jobId: string): CronJobDOStub {
	return env.CRON_JOB_DO.get(env.CRON_JOB_DO.idFromName(jobId)) as unknown as CronJobDOStub;
}

function toView(row: JobDbRow): JobView {
	return {
		id: row.id,
		payerAddress: row.payer_address,
		schedule: row.schedule,
		target: { url: row.target_url, method: row.target_method },
		credits: row.credits,
		status: row.status as JobView["status"],
		nextRunAt: row.next_run_at,
		createdAt: row.created_at,
		notifyUrl: row.notify_url,
	};
}

async function requireOwnedJob(
	c: Context<{ Bindings: Env }>,
	jobId: string,
	action: "delete" | "pause" | "resume",
) {
	const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
		.bind(jobId)
		.first<JobDbRow>();
	if (!row) return { error: c.json({ error: "job not found" }, 404) };
	const parsed = parseManageHeaders(c.req.raw.headers);
	if (!parsed) {
		return {
			error: c.json({ error: "missing x-cron402-signature / x-cron402-timestamp headers" }, 401),
		};
	}
	const ok = await verifyManageSignature({
		address: row.payer_address as `0x${string}`,
		jobId,
		action,
		timestamp: parsed.timestamp,
		signature: parsed.signature,
	});
	if (!ok) return { error: c.json({ error: "invalid or unauthorized signature" }, 403) };
	return { row };
}

// ---- create ----
app.post("/v1/crons", async (c) => {
	const payer = payerFromRequest(c);
	if (!payer) {
		return c.json({ error: "could not determine payer address from payment payload" }, 400);
	}

	const body = await c.req.json().catch(() => null);
	const parsed = createCronRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "invalid request", issues: parsed.error.flatten() }, 400);
	}
	if (nextRunFrom(parsed.data.schedule) === null) {
		return c.json({ error: "invalid cron schedule" }, 400);
	}

	const countRow = await c.env.DB.prepare(
		"SELECT COUNT(*) AS n FROM jobs WHERE payer_address = ? AND status IN ('active','paused','exhausted')",
	)
		.bind(payer)
		.first<{ n: number }>();
	if ((countRow?.n ?? 0) >= MAX_ACTIVE_JOBS_PER_WALLET) {
		return c.json({ error: `active job limit reached (${MAX_ACTIVE_JOBS_PER_WALLET})` }, 429);
	}

	const id = crypto.randomUUID();
	const now = Date.now();
	await c.env.DB.prepare(
		`INSERT INTO jobs (id, payer_address, schedule, target_url, target_method, target_headers, target_body, credits, status, next_run_at, created_at, notify_url)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', NULL, ?, ?)`,
	)
		.bind(
			id,
			payer,
			parsed.data.schedule,
			parsed.data.target.url,
			parsed.data.target.method,
			parsed.data.target.headers ? JSON.stringify(parsed.data.target.headers) : null,
			parsed.data.target.body ?? null,
			now,
			parsed.data.notifyUrl ?? null,
		)
		.run();
	await c.env.DB.prepare(
		"INSERT INTO payments (job_id, payer_address, amount_usd, runs, created_at) VALUES (?, ?, ?, 1, ?)",
	)
		.bind(id, payer, String(PRICE_PER_RUN_USD), now)
		.run();

	await stubFor(c.env, id).init({
		id,
		schedule: parsed.data.schedule,
		target: parsed.data.target,
		notifyUrl: parsed.data.notifyUrl ?? null,
	});

	return c.json({ id, statusUrl: `/v1/crons/${id}`, credits: 1 }, 201);
});

// ---- top-up packs (permissionless: anyone can fund a job) ----
for (const pack of TOPUP_PACKS) {
	app.post(pack.path, async (c) => {
		const body = await c.req.json().catch(() => ({}) as Record<string, unknown>);
		const jobId = typeof body.jobId === "string" ? body.jobId : null;
		if (!jobId) return c.json({ error: "jobId required in body" }, 400);
		const payer = payerFromRequest(c);

		const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
			.bind(jobId)
			.first<JobDbRow>();
		if (!row) return c.json({ error: "job not found" }, 404);

		const result = await c.env.DB.prepare(
			"UPDATE jobs SET credits = credits + ?, status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END WHERE id = ? RETURNING credits",
		)
			.bind(pack.runs, jobId)
			.first<{ credits: number }>();
		if (payer) {
			await c.env.DB.prepare(
				"INSERT INTO payments (job_id, payer_address, amount_usd, runs, created_at) VALUES (?, ?, ?, ?, ?)",
			)
				.bind(jobId, payer, pack.price.toFixed(3), pack.runs, Date.now())
				.run();
		}

		if (row.status === "paused" || row.status === "exhausted") {
			await stubFor(c.env, jobId).resume();
		}

		return c.json({ jobId, runsAdded: pack.runs, credits: result?.credits });
	});
}

// ---- read ----
app.get("/v1/crons/:id", async (c) => {
	const row = await c.env.DB.prepare("SELECT * FROM jobs WHERE id = ?")
		.bind(c.req.param("id"))
		.first<JobDbRow>();
	if (!row) return c.json({ error: "job not found" }, 404);
	const executions = await c.env.DB.prepare(
		"SELECT id, job_id AS jobId, run_at AS runAt, ok, status_code AS statusCode, error, duration_ms AS durationMs FROM executions WHERE job_id = ? ORDER BY run_at DESC LIMIT 20",
	)
		.bind(row.id)
		.all();
	return c.json({ ...toView(row), executions: executions.results ?? [] });
});

// ---- manage (wallet-signed) ----
app.delete("/v1/crons/:id", async (c) => {
	const { row, error } = await requireOwnedJob(c, c.req.param("id"), "delete");
	if (error) return error;
	await c.env.DB.prepare("UPDATE jobs SET status = 'deleted', next_run_at = NULL WHERE id = ?")
		.bind(row.id)
		.run();
	await stubFor(c.env, row.id).cancel();
	return c.json({ ok: true, id: row.id, status: "deleted" });
});

app.post("/v1/crons/:id/pause", async (c) => {
	const { row, error } = await requireOwnedJob(c, c.req.param("id"), "pause");
	if (error) return error;
	await c.env.DB.prepare("UPDATE jobs SET status = 'paused', next_run_at = NULL WHERE id = ?")
		.bind(row.id)
		.run();
	await stubFor(c.env, row.id).cancel();
	return c.json({ ok: true, id: row.id, status: "paused" });
});

app.post("/v1/crons/:id/resume", async (c) => {
	const { row, error } = await requireOwnedJob(c, c.req.param("id"), "resume");
	if (error) return error;
	if (row.credits <= 0) return c.json({ error: "no credits; top up first" }, 400);
	await c.env.DB.prepare("UPDATE jobs SET status = 'active' WHERE id = ?").bind(row.id).run();
	await stubFor(c.env, row.id).resume();
	return c.json({ ok: true, id: row.id, status: "active" });
});

// ---- sweeper: re-kick DOs whose alarms were missed ----
async function sweep(env: Env): Promise<void> {
	const cutoff = Date.now() - 90_000;
	const due = await env.DB.prepare(
		"SELECT id FROM jobs WHERE status = 'active' AND next_run_at IS NOT NULL AND next_run_at < ? LIMIT 100",
	)
		.bind(cutoff)
		.all<{ id: string }>();
	for (const job of due.results ?? []) {
		await stubFor(env, job.id).kick();
	}
}

export default {
	fetch: app.fetch,
	scheduled: (_event: ScheduledController, env: Env, ctx: ExecutionContext) => {
		ctx.waitUntil(sweep(env));
	},
} satisfies ExportedHandler<Env>;
