#!/usr/bin/env node
import { execSync } from "node:child_process";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const API_URL = process.env.CRON402_API_URL ?? "https://cron402-api.user-defaults.workers.dev";

// Never hardcode the key: take it from the environment, else the abracadabra
// vault (Touch ID gated). See AGENTS.md.
const key =
	process.env.CRON402_PRIVATE_KEY ??
	execSync("abra get ai-cron-site EVM_PRIVATE_KEY", { encoding: "utf8" }).trim();
const account = privateKeyToAccount(key);
console.log("payer:", account.address);
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });
const paidFetch = wrapFetchWithPayment(globalThis.fetch, client);

async function tryTrigger(jobId) {
  console.log(`Trying to trigger job ${jobId}...`);
  const res = await paidFetch(`${API_URL}/v1/crons/${jobId}/trigger`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const text = await res.text();
  console.log("Trigger raw:", text, "status:", res.status);
}

async function tryRun(jobId) {
  console.log(`Trying to run job ${jobId}...`);
  const res = await paidFetch(`${API_URL}/v1/crons/${jobId}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
  });
  const text = await res.text();
  console.log("Run raw:", text, "status:", res.status);
}

async function main() {
  const jobId = "319636b4-47cc-441d-932d-5e9dab9b0be0";
  await tryTrigger(jobId);
  await tryRun(jobId);
}

main();
