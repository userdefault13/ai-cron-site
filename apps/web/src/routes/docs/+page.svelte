<script>
const apiUrl = "https://cron402-api.user-defaults.workers.dev"; // replace with deployed Worker URL

const jsonLd = JSON.stringify({
	"@context": "https://schema.org",
	"@type": "TechArticle",
	headline: "cron402 agent integration guide",
	description:
		"How AI agents integrate with cron402: create scheduled webhooks, pay per run via x402 USDC micropayments on Base, and manage jobs with EIP-712 wallet signatures.",
	proficiencyLevel: "Expert",
	dependencies: "Any x402 client (e.g. @x402/fetch) and a funded USDC wallet on Base",
	apiReference: { "@type": "APIReference", url: `${apiUrl}/v1/openapi.json` },
});
</script>

<svelte:head>
	<title>Docs — cron402</title>
	<meta
		name="description"
		content="Agent integration guide for cron402: x402-paid cron jobs, USDC on Base, wallet-signed management."
	/>
	<link rel="canonical" href="https://web-seven-ecru-65.vercel.app/docs" />

	<meta property="og:type" content="article" />
	<meta property="og:site_name" content="cron402" />
	<meta property="og:title" content="cron402 agent integration guide" />
	<meta
		property="og:description"
		content="Create scheduled webhook jobs, pay per run via x402 USDC micropayments on Base, manage jobs with EIP-712 wallet signatures."
	/>
	<meta property="og:url" content="https://web-seven-ecru-65.vercel.app/docs" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="cron402 agent integration guide" />
	<meta
		name="twitter:description"
		content="x402-paid cron jobs in ~20 lines of TypeScript. USDC on Base."
	/>

	{@html jsonLd}
</svelte:head>

<a class="skip" href="#main">Skip to content</a>

<main id="main" tabindex="-1">
	<header>
		<p class="logo"><a href="/">cron<b>402</b></a></p>
		<nav aria-label="Site">
			<a href="/llms.txt">llms.txt</a>
			<a href={`${apiUrl}/v1/openapi.json`}>openapi.json</a>
			<a href="https://www.x402.org" target="_blank" rel="noreferrer">x402.org</a>
		</nav>
	</header>

	<article aria-labelledby="docs-title">
		<h1 id="docs-title">Agent integration guide</h1>
		<p class="muted">
			cron402 is a pure x402 resource server. Every paid endpoint follows the same dance:
			request → <code>402 Payment Required</code> → sign USDC payment (EIP-3009) → retry with
			payment header. Use any x402 client — <code>@x402/fetch</code> is the drop-in option.
		</p>

		<h2>1. Create a cron job</h2>
		<figure aria-label="Shell: install dependencies">
			<pre><code>npm install @x402/fetch @coinbase/cdp-sdk</code></pre>
		</figure>
		<figure aria-label="TypeScript example: create a cron job with x402 payment">
			<pre><code>{`import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { CdpClient } from "@coinbase/cdp-sdk";
import { applySpendControls, fromCdpEvmAccount } from "@coinbase/cdp-sdk/x402";

// Coinbase Agentic Wallet (no private key handling in your code)
const cdp = new CdpClient();
const account = await cdp.evm.getOrCreateAccount({ name: "my-agent" });

const client = new x402Client().register(
  "eip155:8453",                       // Base mainnet
  // "eip155:8453",                     // base mainnet
  new ExactEvmScheme(fromCdpEvmAccount(account)),
);
applySpendControls(client, { maxAmountPerPayment: { atomic: 100_000n } }); // $0.10 cap

const fetchWithPayment = wrapFetchWithPayment(globalThis.fetch, client);

const res = await fetchWithPayment(\`${apiUrl}/v1/crons\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    schedule: "*\/5 * * * *",
    target: {
      url: "https://your-agent.example/tick",
      method: "POST",
      body: JSON.stringify({ hello: "world" })
    }
  }),
});
const { id } = await res.json();`}</code></pre>
		</figure>

		<h2>2. Check status & execution log</h2>
		<figure aria-label="TypeScript example: fetch job status and executions">
			<pre><code>{`const status = await fetch(\`${apiUrl}/v1/crons/\${id}\`).then(r => r.json());
// { credits: 9, status: "active", nextRunAt: 1755000000000,
//   executions: [{ runAt, ok, statusCode, durationMs }, ...] }`}</code></pre>
		</figure>

		<h2>3. Top up run credits ($0.008 / run)</h2>
		<figure aria-label="TypeScript example: top up run credits">
			<pre><code>{`await fetchWithPayment(\`${apiUrl}/v1/crons/topup/10\`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jobId: id }),
});`}</code></pre>
		</figure>

		<h2>4. Pause / resume / delete (wallet-signed)</h2>
		<p>
			Management actions require an EIP-712 signature over
			<code>{"ManageJob { action }"}</code> from the payer's key.
		</p>
		<figure aria-label="TypeScript example: sign a management action and call the API">
			<pre><code>{`const message = {
  action: "pause",                      // "pause" | "resume" | "delete"
  jobId: id,
  timestamp: Date.now(),                // valid for ±5 minutes
};
const signature = await account.signTypedData({
  domain: { name: "cron402", version: "1" },
  types: { ManageJob: [
    { name: "action", type: "string" },
    { name: "jobId", type: "string" },
    { name: "timestamp", type: "uint256" },
  ]},
  primaryType: "ManageJob",
  message,
});

await fetch(\`${apiUrl}/v1/crons/\${id}/pause\`, {
  method: "POST",
  headers: {
    "x-cron402-timestamp": String(message.timestamp),
    "x-cron402-signature": signature,
  },
});`}</code></pre>
		</figure>

		<h2>API reference</h2>
		<table>
			<caption class="muted">
				All cron402 endpoints. Machine-readable version: <a href={`${apiUrl}/v1/openapi.json`}>openapi.json</a>
			</caption>
			<thead>
				<tr>
					<th scope="col">Endpoint</th>
					<th scope="col">Auth</th>
					<th scope="col">Description</th>
				</tr>
			</thead>
			<tbody>
				<tr><td><code>POST /v1/crons</code></td><td>x402 · $0.008</td><td>Create job (includes 1 credit)</td></tr>
				<tr><td><code>POST /v1/crons/topup/1|10|100</code></td><td>x402 · $0.008/$0.08/$0.80</td><td>Add run credits</td></tr>
				<tr><td><code>GET /v1/crons/:id</code></td><td>free</td><td>Status + last executions</td></tr>
				<tr><td><code>GET /v1/openapi.json</code></td><td>free</td><td>OpenAPI 3.1 machine-readable spec</td></tr>
				<tr><td><code>POST /v1/crons/:id/pause</code></td><td>wallet-signed</td><td>Pause job</td></tr>
				<tr><td><code>POST /v1/crons/:id/resume</code></td><td>wallet-signed</td><td>Resume job (needs credits)</td></tr>
				<tr><td><code>DELETE /v1/crons/:id</code></td><td>wallet-signed</td><td>Delete job</td></tr>
			</tbody>
		</table>

		<h2>Limits & policies</h2>
		<ul class="muted">
			<li>Min interval 1 minute · max 1,000 active jobs per wallet</li>
			<li>Failed dispatches retry 3× with backoff, then the job auto-pauses</li>
			<li>Jobs with zero credits pause automatically; top up to reactivate</li>
			<li>Execution logs kept: last 100 runs or 30 days per job</li>
			<li>Live on **Base mainnet** (<code>eip155:8453</code>). Testnet was <code>eip155:84532</code>.</li>
		</ul>
	</article>

	<footer>cron402 docs</footer>
</main>

<style>
	main {
		max-width: 820px;
		margin: 0 auto;
		padding: 1.5rem;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding-bottom: 1.25rem;
		border-bottom: 1px solid var(--border);
		margin-bottom: 2rem;
	}
	.logo {
		font-size: 1rem;
		font-weight: 700;
		margin: 0;
		color: var(--accent2);
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.logo b {
		color: var(--text);
	}
	h1 {
		font-size: 1.4rem;
		margin-bottom: 0.75rem;
		color: var(--accent2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h1::before {
		content: "C:\\DOCS> ";
		color: var(--muted);
	}
	h2 {
		font-size: 1rem;
		margin-top: 2.5rem;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	h2::before {
		content: "> ";
		color: var(--muted);
	}
	figure {
		margin: 0 0 1rem;
		border-left: 3px solid var(--border-bright);
		background: var(--panel);
		padding: 0.85rem 1.1rem;
	}
	pre {
		margin: 0;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--text);
	}
	code {
		font-family: inherit;
		font-size: 0.85rem;
	}
	code:not(pre code) {
		color: var(--warn);
	}
	.muted {
		color: var(--muted);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
		border: 1px solid var(--border);
		margin-top: 1rem;
	}
	caption {
		text-align: left;
		padding-bottom: 0.5rem;
		font-size: 0.8rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.45rem 0.75rem;
		border: 1px solid var(--border);
	}
	th {
		color: var(--accent2);
		font-weight: 700;
		background: var(--panel);
		text-transform: uppercase;
		font-size: 0.78rem;
		letter-spacing: 0.05em;
	}
	td code {
		color: var(--text);
	}
	footer {
		margin-top: 4rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 0.8rem;
	}
</style>
