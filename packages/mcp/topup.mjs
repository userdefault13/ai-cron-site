// Top up a cron402 job with prepaid run credits.
// Usage: node topup.mjs <jobId> [pack]   (pack: 1|10|100, default 10)
import { execSync } from "node:child_process";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const API = process.env.CRON402_API_URL ?? "https://cron402-api.user-defaults.workers.dev";
const jobId = process.argv[2];
const pack = process.argv[3] ?? "10";

if (!jobId) {
	console.error("usage: node topup.mjs <jobId> [pack]");
	process.exit(1);
}

const key = execSync("abra get ai-cron-site EVM_PRIVATE_KEY", { encoding: "utf8" }).trim();
const account = privateKeyToAccount(key);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(globalThis.fetch, client);

const res = await paidFetch(`${API}/v1/crons/topup/${pack}`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify({ jobId }),
});
console.log("status:", res.status);
console.log(JSON.stringify(await res.json()));
