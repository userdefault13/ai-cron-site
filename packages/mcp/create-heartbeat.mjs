import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const API = "https://cron402-api.user-defaults.workers.dev";
const key = execSync("abra get ai-cron-site EVM_PRIVATE_KEY", { encoding: "utf8" }).trim();
const account = privateKeyToAccount(key);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(globalThis.fetch, client);

// top up 90 credits (~30 days at 3 fires/day), then create the heartbeat job
const topup = await paidFetch(`${API}/v1/crons/topup/100`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ jobId: "ef2f8d83-a1b2-4f62-9a7b-74293a05760a" }),
});
console.log("topup:", topup.status, JSON.stringify(await topup.json()));

const res = await paidFetch(`${API}/v1/crons`, {
	method: "POST",
	headers: {
		"content-type": "application/json",
	},
	body: JSON.stringify({
		schedule: "0 */8 * * *",
		target: {
			url: `${API}/v1/moltbook/heartbeat`,
			method: "POST",
			headers: { "x-heartbeat-key": process.env.HEARTBEAT_TOKEN ?? readFileSync("/tmp/hb-token.txt", "utf8").trim() },
		},
		notifyUrl: `${API}/v1/echo`,
	}),
});
console.log("create:", res.status);
console.log("settlement:", res.headers.get("payment-response")?.slice(0, 120));
const data = await res.json();
console.log("job:", JSON.stringify(data));
