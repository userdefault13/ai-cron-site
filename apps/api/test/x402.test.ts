import {
	createExecutionContext,
	runInDurableObject,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import type { JobState } from "../src/scheduler";
import { getJob, getPayments, stub, urlOf, YEARLY } from "./helpers";

const FACILITATOR = "https://facilitator.test";
const NETWORK = "eip155:8453";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
// $0.008 in USDC base units (6 decimals)
const PRICE_ATOMIC = "8000";

// Throwaway payer key, generated per run. It never holds funds and nothing is broadcast.
const payer = privateKeyToAccount(generatePrivateKey());

// biome-ignore lint/suspicious/noExplicitAny: facilitator request bodies are free-form JSON
type FacilitatorCall = { path: string; body: Record<string, any> | null };

/**
 * Fake x402 facilitator. Answers /supported, /verify and /settle without touching
 * the network; any other outbound fetch fails the test.
 */
function mockFacilitator(opts: { verifyValid?: boolean; settleSuccess?: boolean } = {}) {
	const calls: FacilitatorCall[] = [];
	vi.spyOn(globalThis, "fetch").mockImplementation(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = urlOf(input);
			if (!url.startsWith(FACILITATOR)) throw new Error(`unexpected outbound fetch: ${url}`);
			const path = new URL(url).pathname;
			const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
			calls.push({ path, body });
			if (path === "/supported") {
				return Response.json({
					kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
					extensions: ["bazaar"],
					signers: {},
				});
			}
			if (path === "/verify") {
				return Response.json(
					opts.verifyValid === false
						? { isValid: false, invalidReason: "insufficient_funds", payer: payer.address }
						: { isValid: true, payer: payer.address },
				);
			}
			if (path === "/settle") {
				return Response.json(
					opts.settleSuccess === false
						? { success: false, errorReason: "settle_failed", transaction: "", network: NETWORK }
						: {
								success: true,
								transaction: `0x${"ab".repeat(32)}`,
								network: NETWORK,
								payer: payer.address,
							},
				);
			}
			return new Response("not found", { status: 404 });
		},
	);
	return calls;
}

async function call(req: Request) {
	const ctx = createExecutionContext();
	const res = await worker.fetch(req, env, ctx);
	await waitOnExecutionContext(ctx);
	return res;
}

function createRequest(body: unknown, headers: Record<string, string> = {}) {
	return new Request("https://api.test/v1/crons", {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body: JSON.stringify(body),
	});
}

const createBody = (tag: string) => ({
	schedule: YEARLY,
	target: { url: `https://hook.test/${tag}`, method: "POST" },
});

/** Unpaid request -> 402 -> sign the requirements with the throwaway key -> payment header. */
async function paidHeaders(body: unknown): Promise<Record<string, string>> {
	const challenge = await call(createRequest(body));
	expect(challenge.status).toBe(402);
	const client = new x402Client().register("eip155:*", new ExactEvmScheme(payer));
	const http = new x402HTTPClient(client);
	const required = http.getPaymentRequiredResponse(
		(name) => challenge.headers.get(name),
		await challenge.json(),
	);
	const payload = await http.createPaymentPayload(required);
	return http.encodePaymentSignatureHeader(payload);
}

async function jobsForUrl(url: string) {
	const res = await env.DB.prepare("SELECT id FROM jobs WHERE target_url = ?")
		.bind(url)
		.all<{ id: string }>();
	return res.results ?? [];
}

beforeEach(() => {
	// Tests must use the fake facilitator, never local .dev.vars CDP credentials.
	expect(env.SKIP_PAYMENTS).not.toBe("1");
	expect(env.CDP_API_KEY_ID).toBe("");
	expect(env.FACILITATOR_URL).toBe(FACILITATOR);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("POST /v1/crons without payment", () => {
	it("answers 402 with an x402 v2 challenge for $0.008 USDC on Base", async () => {
		mockFacilitator();
		const res = await call(createRequest(createBody("unpaid")));

		expect(res.status).toBe(402);
		const header = res.headers.get("payment-required");
		expect(header).toBeTruthy();
		const challenge = JSON.parse(atob(header as string));
		expect(challenge.x402Version).toBe(2);
		expect(challenge.resource.url).toContain("/v1/crons");
		expect(challenge.accepts).toHaveLength(1);
		expect(challenge.accepts[0]).toMatchObject({
			scheme: "exact",
			network: NETWORK,
			amount: PRICE_ATOMIC,
			payTo: env.PAY_TO_ADDRESS,
		});
		expect(challenge.accepts[0].asset.toLowerCase()).toBe(USDC_BASE.toLowerCase());
		expect(challenge.extensions?.bazaar).toBeDefined();
	});

	it("creates nothing", async () => {
		mockFacilitator();
		await call(createRequest(createBody("unpaid-nothing")));
		expect(await jobsForUrl("https://hook.test/unpaid-nothing")).toHaveLength(0);
	});

	it("leaves free routes free", async () => {
		mockFacilitator();
		const res = await call(new Request("https://api.test/health"));
		expect(res.status).toBe(200);
	});
});

describe("POST /v1/crons with a valid payment", () => {
	it("verifies, runs the handler, settles, and creates the job, payment row and DO", async () => {
		const calls = mockFacilitator();
		const body = createBody("paid");
		const headers = await paidHeaders(body);

		const res = await call(createRequest(body, headers));

		expect(res.status).toBe(201);
		const json = (await res.json()) as { id: string; statusUrl: string; credits: number };
		expect(json).toMatchObject({ statusUrl: `/v1/crons/${json.id}`, credits: 1 });
		expect(res.headers.get("payment-response")).toBeTruthy();

		const paths = calls.map((c) => c.path);
		expect(paths).toContain("/verify");
		expect(paths).toContain("/settle");
		expect(paths.indexOf("/verify")).toBeLessThan(paths.indexOf("/settle"));
		const verify = calls.find((c) => c.path === "/verify");
		expect(verify?.body?.paymentRequirements).toMatchObject({
			amount: PRICE_ATOMIC,
			payTo: env.PAY_TO_ADDRESS,
		});
		expect(verify?.body?.paymentPayload?.payload?.authorization?.from?.toLowerCase()).toBe(
			payer.address.toLowerCase(),
		);

		const row = await getJob(json.id);
		expect(row).toMatchObject({
			payer_address: payer.address.toLowerCase(),
			schedule: YEARLY,
			target_url: "https://hook.test/paid",
			target_method: "POST",
			credits: 1,
			status: "active",
		});
		expect(row?.next_run_at).toBeGreaterThan(Date.now());

		const payments = await getPayments(json.id);
		expect(payments).toEqual([
			expect.objectContaining({
				payer_address: payer.address.toLowerCase(),
				amount_usd: "0.008",
				runs: 1,
			}),
		]);

		const doState = await runInDurableObject(stub(json.id), async (_instance, state) => ({
			job: await state.storage.get<JobState>("job"),
			alarm: await state.storage.getAlarm(),
		}));
		expect(doState.job).toMatchObject({ jobId: json.id, status: "active" });
		expect(doState.alarm).toBe(row?.next_run_at);
	});

	it("does not settle or create a job when the paid body is invalid", async () => {
		const calls = mockFacilitator();
		const bad = { schedule: "nope", target: { url: "not-a-url" } };
		const headers = await paidHeaders(bad);

		const res = await call(createRequest(bad, headers));

		expect(res.status).toBe(400);
		expect(calls.map((c) => c.path)).not.toContain("/settle");
	});
});

describe("POST /v1/crons with a rejected payment", () => {
	it("returns 402 and creates nothing when the facilitator says the payment is invalid", async () => {
		const body = createBody("rejected");
		mockFacilitator();
		const headers = await paidHeaders(body);
		vi.restoreAllMocks();
		const calls = mockFacilitator({ verifyValid: false });

		const res = await call(createRequest(body, headers));

		expect(res.status).toBe(402);
		expect(calls.map((c) => c.path)).not.toContain("/settle");
		expect(await jobsForUrl("https://hook.test/rejected")).toHaveLength(0);
	});
});
