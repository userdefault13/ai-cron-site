<script>
const price = "$0.008";

const jsonLd = JSON.stringify({
	"@context": "https://schema.org",
	"@type": "SoftwareApplication",
	name: "cron402",
	applicationCategory: "DeveloperApplication",
	description:
		"Cron-as-a-service for AI agents. Schedule webhook calls and pay per run in USDC on Base via the x402 protocol.",
	operatingSystem: "Web",
	featureList: [
		"Arbitrary cron expressions",
		"x402 USDC micropayments on Base",
		"EIP-712 wallet-signed job management",
		"Automatic retry and pause policies",
	],
	offers: {
		"@type": "Offer",
		price: "0.008",
		priceCurrency: "USD",
		description: "Per webhook invocation (prepaid run credits)",
	},
});

const features = [
	{
		title: "Pay-per-invocation",
		body: `${price} USDC per fire, prepaid in packs of 1 / 10 / 100. Never pay for a run you don't get.`,
	},
	{
		title: "Real cron expressions",
		body: "Per-job Durable Object alarms execute on schedule to the minute — not coarse intervals.",
	},
	{
		title: "Wallet-signed control",
		body: "Pause, resume, or delete jobs with an EIP-712 signature from the payer's key. Nothing else.",
	},
	{
		title: "Agent wallets native",
		body: "Built for Coinbase Agentic Wallets and any x402 client. Humans never need to be present.",
	},
	{
		title: "Reliable dispatch",
		body: "3 retries with backoff, then auto-pause. Missed alarms swept by a global scheduler.",
	},
	{
		title: "Transparent receipts",
		body: "Every execution and payment is logged and queryable: status codes, latency, settlement refs.",
	},
];
</script>

<svelte:head>
	<title>cron402 — pay-per-run cron for AI agents</title>
	<meta
		name="description"
		content="Scheduled webhooks for AI agents. Pay per run in USDC on Base via x402. No accounts, no API keys — your wallet is the credential."
	/>
	<link rel="canonical" href="https://web-seven-ecru-65.vercel.app/" />

	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="cron402" />
	<meta property="og:title" content="cron402 — pay-per-run cron for AI agents" />
	<meta
		property="og:description"
		content="Schedule webhook calls with a single signed request. $0.008 USDC per run on Base via the x402 protocol."
	/>
	<meta property="og:url" content="https://web-seven-ecru-65.vercel.app/" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content="cron402 — pay-per-run cron for AI agents" />
	<meta
		name="twitter:description"
		content="$0.008/run cron jobs for AI agents. x402 native, USDC on Base, wallet-signed control."
	/>

	{@html jsonLd}
</svelte:head>

<a class="skip" href="#main">Skip to content</a>

<main id="main" tabindex="-1">
	<header>
		<p class="logo">cron<b>402</b></p>
		<nav aria-label="Site">
			<a href="/docs">Docs</a>
			<a href="/llms.txt">llms.txt</a>
			<a href="https://www.x402.org" target="_blank" rel="noreferrer">x402.org</a>
		</nav>
	</header>

	<section class="hero" aria-labelledby="hero-title">
		<h1 id="hero-title">Cron for AI agents.<br />Paid per run, in USDC, on Base.</h1>
		<p class="sub">
			Schedule webhook calls with a single signed request. Every fire costs {price} — settled
			instantly over the x402 protocol. No accounts. No API keys. Your wallet is the credential.
		</p>
		<figure class="snippet-figure" aria-label="Example request: create a cron job">
			<pre><code>POST /v1/crons          <span class="dim">// 402 → sign → retry, like any x402 endpoint</span>
{{
  "schedule": "*\/5 * * * *",
  "target": { "url": "https://your-agent.example/tick", "method": "POST" }
}}</code></pre>
			<figcaption class="dim">Machine-readable spec: <a href="https://cron402-api.user-defaults.workers.dev/v1/openapi.json">/v1/openapi.json</a></figcaption>
		</figure>
		<p class="cta">
			<a href="/docs">Integrate your agent →</a>
		</p>
	</section>

	<section class="grid" aria-label="Features">
		{#each features as feature}
			<article class="card">
				<h2>{feature.title}</h2>
				<p>{feature.body}</p>
			</article>
		{/each}
	</section>

	<footer>
		<p>cron402 · Base mainnet · x402 protocol</p>
	</footer>
</main>

<style>
	main {
		max-width: 960px;
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
	nav {
		display: flex;
		gap: 1.25rem;
	}
	h1 {
		font-size: clamp(1.1rem, 3vw, 1.6rem);
		line-height: 1.35;
		margin: 0 0 1rem;
		color: var(--accent2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h1::before {
		content: "C:\\> ";
		color: var(--muted);
	}
	.sub {
		color: var(--muted);
		max-width: 70ch;
		margin-top: 0;
	}
	.snippet-figure {
		margin: 1.5rem 0;
		border: 1px solid var(--border-bright);
		background: var(--panel);
		padding: 1rem 1.25rem;
	}
	.snippet-figure pre {
		margin: 0;
		overflow-x: auto;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--text);
	}
	.snippet-figure figcaption {
		padding-top: 0.5rem;
		font-size: 0.8rem;
		border-top: 1px dashed var(--border);
		margin-top: 0.75rem;
	}
	.dim {
		color: var(--muted);
	}
	.cta a {
		font-weight: 700;
		color: var(--warn);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
		gap: 1rem;
		margin-top: 3rem;
	}
	.card {
		background: var(--panel);
		border: 1px solid var(--border);
		padding: 1rem 1.15rem;
		margin: 0;
	}
	.card h2 {
		margin: 0 0 0.6rem;
		font-size: 0.95rem;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.card h2::before {
		content: "* ";
		color: var(--muted);
	}
	.card p {
		margin: 0;
		color: var(--muted);
		font-size: 0.85rem;
	}
	footer {
		margin-top: 4rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 0.8rem;
	}
</style>
