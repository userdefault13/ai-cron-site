import { verifyTypedData } from "viem";

const DOMAIN = { name: "cron402", version: "1" } as const;

export type ManageAction = "delete" | "pause" | "resume";

// 5 minute validity window for signed management requests
const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Verify an EIP-712 signature authorizing a job-management action.
 * Signed message shape (primaryType "ManageJob"):
 *   { action, jobId, timestamp }
 */
export async function verifyManageSignature(params: {
	address: string;
	jobId: string;
	action: ManageAction;
	timestamp: number;
	signature: `0x${string}`;
}): Promise<boolean> {
	if (Math.abs(Date.now() - params.timestamp) > MAX_SKEW_MS) {
		return false;
	}
	try {
		return await verifyTypedData({
			...DOMAIN,
			types: {
				ManageJob: [
					{ name: "action", type: "string" },
					{ name: "jobId", type: "string" },
					{ name: "timestamp", type: "uint256" },
				],
			},
			primaryType: "ManageJob",
			message: {
				action: params.action,
				jobId: params.jobId,
				timestamp: BigInt(params.timestamp),
			},
			address: params.address as `0x${string}`,
			signature: params.signature,
		});
	} catch {
		return false;
	}
}

export function parseManageHeaders(headers: Headers): {
	timestamp: number;
	signature: `0x${string}`;
} | null {
	const ts = Number(headers.get("x-cron402-timestamp"));
	const signature = headers.get("x-cron402-signature");
	if (!Number.isFinite(ts) || !signature?.startsWith("0x")) return null;
	return { timestamp: ts, signature: signature as `0x${string}` };
}
