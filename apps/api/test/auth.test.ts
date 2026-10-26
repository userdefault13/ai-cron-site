import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { type ManageAction, parseManageHeaders, verifyManageSignature } from "../src/auth";

// Throwaway keys generated per run. Never funded, never persisted.
const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());

const JOB_A = "11111111-1111-4111-8111-111111111111";
const JOB_B = "22222222-2222-4222-8222-222222222222";

function sign(
	account: typeof owner,
	message: { action: ManageAction; jobId: string; timestamp: number },
) {
	return account.signTypedData({
		domain: { name: "cron402", version: "1" },
		types: {
			ManageJob: [
				{ name: "action", type: "string" },
				{ name: "jobId", type: "string" },
				{ name: "timestamp", type: "uint256" },
			],
		},
		primaryType: "ManageJob",
		message: { ...message, timestamp: BigInt(message.timestamp) },
	});
}

describe("verifyManageSignature (EIP-712 ManageJob)", () => {
	it("accepts a fresh signature from the job's payer", async () => {
		const timestamp = Date.now();
		const signature = await sign(owner, { action: "pause", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "pause",
				timestamp,
				signature,
			}),
		).resolves.toBe(true);
	});

	it("accepts the payer address in lowercase (as stored in D1)", async () => {
		const timestamp = Date.now();
		const signature = await sign(owner, { action: "delete", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address.toLowerCase(),
				jobId: JOB_A,
				action: "delete",
				timestamp,
				signature,
			}),
		).resolves.toBe(true);
	});

	it("accepts a timestamp just inside the 5-minute window", async () => {
		const timestamp = Date.now() - 4 * 60 * 1000;
		const signature = await sign(owner, { action: "resume", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "resume",
				timestamp,
				signature,
			}),
		).resolves.toBe(true);
	});

	it("rejects an expired timestamp (older than 5 minutes)", async () => {
		const timestamp = Date.now() - 6 * 60 * 1000;
		const signature = await sign(owner, { action: "pause", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "pause",
				timestamp,
				signature,
			}),
		).resolves.toBe(false);
	});

	it("rejects a timestamp more than 5 minutes in the future (clock-skew guard)", async () => {
		const timestamp = Date.now() + 6 * 60 * 1000;
		const signature = await sign(owner, { action: "pause", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "pause",
				timestamp,
				signature,
			}),
		).resolves.toBe(false);
	});

	it("rejects a valid signature from a different wallet", async () => {
		const timestamp = Date.now();
		const signature = await sign(stranger, { action: "delete", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "delete",
				timestamp,
				signature,
			}),
		).resolves.toBe(false);
	});

	it("rejects a signature replayed against a different action", async () => {
		const timestamp = Date.now();
		const pauseSig = await sign(owner, { action: "pause", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "delete",
				timestamp,
				signature: pauseSig,
			}),
		).resolves.toBe(false);
	});

	it("rejects a signature replayed against a different job", async () => {
		const timestamp = Date.now();
		const sigForA = await sign(owner, { action: "delete", jobId: JOB_A, timestamp });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_B,
				action: "delete",
				timestamp,
				signature: sigForA,
			}),
		).resolves.toBe(false);
	});

	it("rejects a signature whose signed timestamp differs from the header timestamp", async () => {
		const signedAt = Date.now() - 60_000;
		const signature = await sign(owner, { action: "pause", jobId: JOB_A, timestamp: signedAt });
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "pause",
				timestamp: Date.now(),
				signature,
			}),
		).resolves.toBe(false);
	});

	it("rejects a signature made over a different EIP-712 domain (regression)", async () => {
		const timestamp = Date.now();
		const signature = await owner.signTypedData({
			domain: { name: "not-cron402", version: "1" },
			types: {
				ManageJob: [
					{ name: "action", type: "string" },
					{ name: "jobId", type: "string" },
					{ name: "timestamp", type: "uint256" },
				],
			},
			primaryType: "ManageJob",
			message: { action: "pause", jobId: JOB_A, timestamp: BigInt(timestamp) },
		});
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "pause",
				timestamp,
				signature,
			}),
		).resolves.toBe(false);
	});

	it("returns false (does not throw) for a malformed signature", async () => {
		await expect(
			verifyManageSignature({
				address: owner.address,
				jobId: JOB_A,
				action: "pause",
				timestamp: Date.now(),
				signature: "0xdeadbeef",
			}),
		).resolves.toBe(false);
	});
});

describe("parseManageHeaders", () => {
	it("parses x-cron402-timestamp and x-cron402-signature", () => {
		const headers = new Headers({
			"x-cron402-timestamp": "1700000000000",
			"x-cron402-signature": "0xabc",
		});
		expect(parseManageHeaders(headers)).toEqual({ timestamp: 1700000000000, signature: "0xabc" });
	});

	it("returns null when the signature header is missing or not hex-prefixed", () => {
		expect(parseManageHeaders(new Headers({ "x-cron402-timestamp": "1" }))).toBeNull();
		expect(
			parseManageHeaders(new Headers({ "x-cron402-timestamp": "1", "x-cron402-signature": "abc" })),
		).toBeNull();
	});

	it("returns null for a non-numeric timestamp", () => {
		expect(
			parseManageHeaders(
				new Headers({ "x-cron402-timestamp": "soon", "x-cron402-signature": "0xabc" }),
			),
		).toBeNull();
	});
});
