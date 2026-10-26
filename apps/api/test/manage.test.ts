import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManageAction } from "../src/auth";
import worker from "../src/index";
import { getJob, insertJob, rpc } from "./helpers";

// Throwaway keys generated per run.
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

/** Sign exactly like the MCP server and the dashboard do (domain { name: "cron402", version: "1" }). */
async function signedHeaders(account: typeof owner, action: ManageAction, jobId: string) {
	const timestamp = Date.now();
	const signature = await account.signTypedData({
		domain: { name: "cron402", version: "1" },
		types: {
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

async function call(path: string, method: string, headers: Record<string, string> = {}) {
	const ctx = createExecutionContext();
	const res = await worker.fetch(
		new Request(`https://api.test${path}`, { method, headers }),
		env,
		ctx,
	);
	await waitOnExecutionContext(ctx);
	return res;
}

async function ownedActiveJob() {
	const job = await insertJob({ payer_address: owner.address.toLowerCase(), credits: 2 });
	await rpc(job.id).init({
		id: job.id,
		schedule: job.schedule,
		target: { url: job.target_url, method: "POST" },
	});
	return job;
}

beforeEach(() => {
	// The x402 middleware wraps every /v1/* route and may ask the facilitator for
	// its supported kinds. Answer locally so nothing leaves the test process.
	vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
		Response.json({
			kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
			extensions: [],
			signers: {},
		}),
	);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("wallet-signed management routes", () => {
	it("pause: the payer's signature is accepted", async () => {
		const job = await ownedActiveJob();
		const res = await call(
			`/v1/crons/${job.id}/pause`,
			"POST",
			await signedHeaders(owner, "pause", job.id),
		);
		expect(res.status).toBe(200);
		expect(await getJob(job.id)).toMatchObject({ status: "paused", next_run_at: null });
	});

	it("resume: the payer's signature re-activates a paused job", async () => {
		const job = await ownedActiveJob();
		await call(`/v1/crons/${job.id}/pause`, "POST", await signedHeaders(owner, "pause", job.id));
		const res = await call(
			`/v1/crons/${job.id}/resume`,
			"POST",
			await signedHeaders(owner, "resume", job.id),
		);
		expect(res.status).toBe(200);
		const row = await getJob(job.id);
		expect(row?.status).toBe("active");
		expect(row?.next_run_at).toBeGreaterThan(Date.now());
	});

	it("delete: the payer's signature soft-deletes the job", async () => {
		const job = await ownedActiveJob();
		const res = await call(
			`/v1/crons/${job.id}`,
			"DELETE",
			await signedHeaders(owner, "delete", job.id),
		);
		expect(res.status).toBe(200);
		expect((await getJob(job.id))?.status).toBe("deleted");
	});

	it("rejects a signature from a different wallet with 403", async () => {
		const job = await ownedActiveJob();
		const res = await call(
			`/v1/crons/${job.id}/pause`,
			"POST",
			await signedHeaders(stranger, "pause", job.id),
		);
		expect(res.status).toBe(403);
		expect((await getJob(job.id))?.status).toBe("active");
	});

	it("rejects a pause signature replayed as a delete with 403", async () => {
		const job = await ownedActiveJob();
		const res = await call(
			`/v1/crons/${job.id}`,
			"DELETE",
			await signedHeaders(owner, "pause", job.id),
		);
		expect(res.status).toBe(403);
		expect((await getJob(job.id))?.status).toBe("active");
	});

	it("rejects a request without signature headers with 401", async () => {
		const job = await ownedActiveJob();
		const res = await call(`/v1/crons/${job.id}/pause`, "POST");
		expect(res.status).toBe(401);
	});

	it("returns 404 for an unknown job", async () => {
		const res = await call(`/v1/crons/${crypto.randomUUID()}/pause`, "POST", {
			"x-cron402-timestamp": String(Date.now()),
			"x-cron402-signature": "0x00",
		});
		expect(res.status).toBe(404);
	});
});
