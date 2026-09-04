#!/usr/bin/env node
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";

const PRIVATE_KEY = "0x2a67dba4e7e25347318bf1540d09ec1c430f7f6cea0c4759433f74bb426261ad";
const API_URL = "https://cron402-api.user-defaults.workers.dev";

const account = privateKeyToAccount(PRIVATE_KEY);
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
