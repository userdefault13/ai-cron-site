<script lang="ts">
type Execution = {
	id: number;
	runAt: number;
	ok: number;
	statusCode: number | null;
	error: string | null;
	durationMs: number;
};

type Job = {
	id: string;
	payerAddress: string;
	schedule: string;
	target: { url: string; method: string };
	credits: number;
	status: string;
	nextRunAt: number | null;
	createdAt: number;
	notifyUrl: string | null;
	executions?: Execution[];
};

const API_URL = "https://cron402-api.user-defaults.workers.dev";

// biome-ignore lint/suspicious/noExplicitAny: EIP-1193 provider injected by browser wallets
let ethereum: any = $state(undefined);
let account = $state<string | null>(null);
let chainId = $state<string | null>(null);
let error = $state<string | null>(null);
let busy = $state(false);
let statusMsg = $state<string | null>(null);

let jobIdInput = $state("");
let job = $state<Job | null>(null);

function loadProvider() {
	// @ts-expect-error injected by browser wallets
	ethereum = window.ethereum ?? undefined;
	if (!ethereum) {
		error = "No injected wallet found. Install MetaMask or any EIP-1193 wallet.";
	}
}

async function connect() {
	loadProvider();
	if (!ethereum) return;
	try {
		error = null;
		const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
		account = accounts[0] ?? null;
		chainId = await ethereum.request({ method: "eth_chainId" });
		ethereum.on?.("accountsChanged", (accs: string[]) => {
			account = accs[0] ?? null;
			job = null;
		});
		ethereum.on?.("chainChanged", (cid: string) => (chainId = cid));
	} catch (e) {
		error = e instanceof Error ? e.message : "Wallet connection rejected";
	}
}

async function fetchJob() {
	const id = jobIdInput.trim();
	if (!id) {
		error = "Enter a job id";
		return;
	}
	error = null;
	statusMsg = null;
	busy = true;
	try {
		const res = await fetch(`${API_URL}/v1/crons/${id}`);
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
		job = data;
	} catch (e) {
		job = null;
		error = e instanceof Error ? e.message : "Failed to fetch job";
	} finally {
		busy = false;
	}
}

async function signManage(action: "pause" | "resume" | "delete", id: string): Promise<string> {
	const message = { action, jobId: id, timestamp: Date.now() };
	return ethereum.request({
		method: "eth_signTypedData_v4",
		params: [
			account,
			JSON.stringify({
				domain: { name: "cron402", version: "1" },
				types: {
					EIP712Domain: [
						{ name: "name", type: "string" },
						{ name: "version", type: "string" },
					],
					ManageJob: [
						{ name: "action", type: "string" },
						{ name: "jobId", type: "string" },
						{ name: "timestamp", type: "uint256" },
					],
				},
				primaryType: "ManageJob",
				message,
			}),
		],
	});
}

async function manage(action: "pause" | "resume" | "delete") {
	if (!job || !account || !ethereum) return;
	busy = true;
	error = null;
	statusMsg = null;
	try {
		const signature = await signManage(action, job.id);
		const timestamp = Date.now().toString();
		const res = await fetch(
			action === "delete"
				? `${API_URL}/v1/crons/${job.id}`
				: `${API_URL}/v1/crons/${job.id}/${action}`,
			{
				method: action === "delete" ? "DELETE" : "POST",
				headers: {
					"x-cron402-timestamp": timestamp,
					"x-cron402-signature": signature,
				},
			},
		);
		const data = await res.json();
		if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
		statusMsg = `${action} ok`;
		await fetchJob();
	} catch (e) {
		error = e instanceof Error ? e.message : `${action} failed`;
	} finally {
		busy = false;
	}
}

const short = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
</script>

<svelte:head>
	<title>Dashboard — cron402</title>
	<meta name="description" content="Manage cron402 jobs: connect a wallet to inspect, pause, resume, or delete jobs." />
</svelte:head>

<a class="skip" href="#main">Skip to content</a>

<main id="main" tabindex="-1">
	<header>
		<p class="logo"><a href="/">cron<b>402</b></a></p>
		<nav aria-label="Site">
			<a href="/docs">docs</a>
			<a href="/llms.txt">llms.txt</a>
		</nav>
	</header>

	<article aria-labelledby="dash-title">
		<h1 id="dash-title">Job console</h1>

		<section aria-label="Wallet connection" class="panel">
			{#if account}
				<p class="ok">
					WALLET: <b>{short(account)}</b> · CHAIN: <b>{chainId ?? "?"}</b>
				</p>
			{:else}
				<button onclick={connect}>[ connect wallet ]</button>
				{#if error}<p class="err">{error}</p>{/if}
			{/if}
		</section>

		{#if account}
			<section aria-label="Load a job" class="panel">
				<form
					onsubmit={(e) => {
						e.preventDefault();
						fetchJob();
					}}
				>
					<label for="jobid">JOB ID:</label>
					<input
						id="jobid"
						bind:value={jobIdInput}
						placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
						spellcheck="false"
					/>
					<button type="submit" disabled={busy}>[ load ]</button>
				</form>
			</section>
		{/if}

		{#if statusMsg}<p class="ok" role="status">&gt;&gt; {statusMsg}</p>{/if}
		{#if error && account}<p class="err" role="alert">!! {error}</p>{/if}

		{#if job}
			<section aria-label="Job details" class="panel">
				<h2>JOB {job.id.slice(0, 8)}…</h2>
				<table>
					<tbody>
						<tr><th scope="row">status</th><td><b class={job.status === "active" ? "ok" : "warn"}>{job.status}</b></td></tr>
						<tr><th scope="row">schedule</th><td><code>{job.schedule}</code></td></tr>
						<tr><th scope="row">target</th><td><code>{job.target.method} {job.target.url}</code></td></tr>
						<tr><th scope="row">credits</th><td>{job.credits}</td></tr>
						<tr><th scope="row">payer</th><td>{short(job.payerAddress)}</td></tr>
						<tr><th scope="row">next run</th><td>{job.nextRunAt ? new Date(job.nextRunAt).toISOString().replace("T", " ").slice(0, 19) + "Z" : "—"}</td></tr>
						<tr><th scope="row">notify url</th><td><code>{job.notifyUrl ?? "—"}</code></td></tr>
					</tbody>
				</table>

				<div class="actions" role="group" aria-label="Job actions">
					<button onclick={() => manage("pause")} disabled={busy || job.status !== "active"}>[ pause ]</button>
					<button onclick={() => manage("resume")} disabled={busy || job.status === "active" || job.credits === 0}>[ resume ]</button>
					<button class="danger" onclick={() => manage("delete")} disabled={busy}>[ delete ]</button>
				</div>
				{#if job.credits === 0}
					<p class="warn-text">0 credits — top up via x402 at <code>POST /v1/crons/topup/10</code></p>
				{/if}
			</section>

			{#if job.executions?.length}
				<section aria-label="Execution log" class="panel">
					<h2>EXECUTIONS (LAST 20)</h2>
					<table>
						<thead>
							<tr>
								<th scope="col">run at</th>
								<th scope="col">result</th>
								<th scope="col">http</th>
								<th scope="col">ms</th>
								<th scope="col">error</th>
							</tr>
						</thead>
						<tbody>
							{#each job.executions as ex (ex.id)}
								<tr>
									<td>{new Date(ex.runAt).toISOString().replace("T", " ").slice(11, 19)}</td>
									<td><span class={ex.ok ? "ok" : "err"}>{ex.ok ? "OK" : "FAIL"}</span></td>
									<td>{ex.statusCode ?? "—"}</td>
									<td>{ex.durationMs}</td>
									<td class="muted">{ex.error ?? ""}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</section>
			{/if}
		{/if}
	</article>

	<footer>payer key signs every action — the server holds no authority</footer>
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
		margin-bottom: 1rem;
		color: var(--accent2);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	h1::before {
		content: "C:\\CONSOLE> ";
		color: var(--muted);
	}
	h2 {
		font-size: 0.95rem;
		margin: 0 0 0.75rem;
		color: var(--accent);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.panel {
		background: var(--panel);
		border: 1px solid var(--border);
		padding: 1rem 1.15rem;
		margin-bottom: 1rem;
	}
	button {
		background: transparent;
		border: 1px solid var(--border-bright);
		color: var(--accent2);
		font-family: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.6rem;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: var(--accent2);
		color: #000;
	}
	button.danger {
		color: #ff5555;
		border-color: #ff5555;
	}
	button.danger:hover:not(:disabled) {
		background: #ff5555;
		color: #000;
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	input {
		background: var(--bg);
		border: 1px solid var(--border-bright);
		color: var(--text);
		font-family: inherit;
		font-size: 0.85rem;
		padding: 0.35rem 0.6rem;
		width: min(100%, 26rem);
	}
	form {
		display: flex;
		gap: 0.6rem;
		align-items: center;
		flex-wrap: wrap;
	}
	label {
		color: var(--muted);
		font-size: 0.85rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.85rem;
		margin-top: 0.25rem;
	}
	th,
	td {
		text-align: left;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		vertical-align: top;
	}
	th {
		color: var(--accent2);
		background: var(--bg);
		width: 9rem;
		font-weight: 700;
	}
	thead th {
		width: auto;
	}
	code {
		color: var(--text);
		font-size: 0.8rem;
		word-break: break-all;
	}
	.ok {
		color: var(--accent2);
	}
	.err {
		color: #ff5555;
	}
	.warn,
	.warn-text {
		color: var(--warn);
	}
	.muted {
		color: var(--muted);
	}
	.actions {
		display: flex;
		gap: 0.6rem;
		margin-top: 1rem;
		flex-wrap: wrap;
	}
	footer {
		margin-top: 3rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border);
		color: var(--muted);
		font-size: 0.8rem;
	}
</style>
