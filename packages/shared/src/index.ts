import type { JobStatus } from "./schemas.js";

export * from "./schemas.js";

export interface JobRecord {
	id: string;
	payerAddress: string;
	schedule: string;
	targetUrl: string;
	targetMethod: string;
	targetHeaders: string | null;
	targetBody: string | null;
	credits: number;
	status: JobStatus;
	consecutiveFailures: number;
	nextRunAt: number | null;
	createdAt: number;
}

/** Shape of a row as returned by D1 (snake_case columns). */
export interface JobDbRow {
	id: string;
	payer_address: string;
	schedule: string;
	target_url: string;
	target_method: string;
	target_headers: string | null;
	target_body: string | null;
	credits: number;
	status: string;
	consecutive_failures: number;
	next_run_at: number | null;
	created_at: number;
	notify_url: string | null;
}

export interface ExecutionRecord {
	id: number;
	jobId: string;
	runAt: number;
	ok: number;
	statusCode: number | null;
	error: string | null;
	durationMs: number;
}

export interface JobView {
	id: string;
	payerAddress: string;
	schedule: string;
	target: { url: string; method: string };
	credits: number;
	status: JobStatus;
	nextRunAt: number | null;
	createdAt: number;
	notifyUrl: string | null;
}

export * from "./json-schema.js";
