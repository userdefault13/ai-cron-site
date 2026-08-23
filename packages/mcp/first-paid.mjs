// First paid cron402 transaction: create a job via x402 and watch it fire.
import { execSync } from "node:child_process";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const API = "https://cron402-api.user-defaults.workers.dev";
const NETWORK = "eip155:84532";

const key = process.env.CRON402_PRIVATE_KEY
	?? execSync("abra get ai-cron-site EVM_PRIVATE_KEY", { encoding: "utf8" }).trim();
const account = privateKeyToAccount(key);
console.log("payer:", account.address);

const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(globalThis.fetch, client);

const body = {
	schedule: "* * * * *",
	target: {
		url: `${API}/v1/echo`,
		method: "POST",
		body: JSON.stringify({ hello: "from the first paid run" }),
	},
};

const res = await paidFetch(`${API}/v1/crons`, {
	method: "POST",
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

console.log("status:", res.status);
const paymentResponse = res.headers.get("payment-response");
if (paymentResponse) {
	try {
		const decoded = JSON.parse(
			Buffer.from(paymentResponse, "base64").toString("utf8"),
		);
		console.log("settlement:", JSON.stringify(decoded, null, 2));
	} catch {
		console.log("payment-response:", paymentResponse.slice(0, 200));
	}
}
const data = await res.json();
console.log("response:", JSON.stringify(data));

if (!data.id) process.exit(1);

console.log("\nwaiting up to 90s for the first scheduled fire…");
const deadline = Date.now() + 90_000;
while (Date.now() < deadline) {
	await new Promise((r) => setTimeout(r, 10_000));
	const check = await fetch(`${API}/v1/crons/${data.id}`);
	const job = await check.json();
	console.log(
		`poll: status=${job.status} credits=${job.credits} runs=${job.executions?.length ?? 0}`,
	);
	if ((job.executions?.length ?? 0) > 0) {
		console.log("FIRST PAID RUN COMPLETE:", JSON.stringify(job.executions[0]));
		process.exit(0);
	}
}
console.log("no execution observed before deadline");
process.exit(1);
