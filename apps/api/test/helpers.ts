import { env } from "cloudflare:workers";
import type { JobDbRow } from "@cron402/shared";
import type { CronJobDOStub } from "../src/types";

/** Far-future schedule (Jan 1, 00:00 UTC) so real alarms never fire mid-test. */
export const YEARLY = "0 0 1 1 *";

export function stub(jobId: string) {
	return env.CRON_JOB_DO.get(env.CRON_JOB_DO.idFromName(jobId));
}

export function rpc(jobId: string): CronJobDOStub {
	return stub(jobId) as unknown as CronJobDOStub;
}

export async function insertJob(overrides: Partial<JobDbRow> = {}): Promise<JobDbRow> {
	const row: JobDbRow = {
		id: crypto.randomUUID(),
		payer_address: "0x00000000000000000000000000000000000000aa",
		schedule: YEARLY,
		target_url: `https://hook.test/${crypto.randomUUID()}`,
		target_method: "POST",
		target_headers: null,
		target_body: null,
		credits: 3,
		status: "active",
		consecutive_failures: 0,
		next_run_at: null,
		created_at: Date.now(),
		notify_url: null,
		...overrides,
	};
	await env.DB.prepare(
		`INSERT INTO jobs (id, payer_address, schedule, target_url, target_method, target_headers, target_body,
		 credits, status, consecutive_failures, next_run_at, created_at, notify_url)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			row.id,
			row.payer_address,
			row.schedule,
			row.target_url,
			row.target_method,
			row.target_headers,
			row.target_body,
			row.credits,
			row.status,
			row.consecutive_failures,
			row.next_run_at,
			row.created_at,
			row.notify_url,
		)
		.run();
	return row;
}

export function getJob(id: string) {
	return env.DB.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first<JobDbRow>();
}

export async function getExecutions(jobId: string) {
	const res = await env.DB.prepare("SELECT * FROM executions WHERE job_id = ? ORDER BY id")
		.bind(jobId)
		.all<{ ok: number; status_code: number | null; error: string | null }>();
	return res.results ?? [];
}

export async function getPayments(jobId: string) {
	const res = await env.DB.prepare("SELECT * FROM payments WHERE job_id = ? ORDER BY id")
		.bind(jobId)
		.all<{ payer_address: string; amount_usd: string; runs: number }>();
	return res.results ?? [];
}

/** Return the URL string for any fetch() input shape. */
export function urlOf(input: RequestInfo | URL): string {
	if (typeof input === "string") return input;
	if (input instanceof URL) return input.toString();
	return input.url;
}
