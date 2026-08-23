import { z } from "zod";

export const PRICE_PER_RUN_USD = 0.008;
export const MAX_ACTIVE_JOBS_PER_WALLET = 1000;
export const MAX_EXECUTIONS_RETAINED = 100;
export const RETENTION_DAYS = 30;
export const MAX_RETRIES = 3;
export const WEBHOOK_TIMEOUT_SECONDS = 10;

export const cronScheduleSchema = z
	.string()
	.min(9)
	.max(64)
	.refine((s) => !s.includes("\n"), "invalid cron expression");

export const targetSchema = z.object({
	url: z.string().url().max(2048),
	method: z.enum(["GET", "POST"]).default("POST"),
	headers: z.record(z.string().max(256)).optional(),
	body: z.string().max(16384).optional(),
});

export const createCronRequestSchema = z.object({
	schedule: cronScheduleSchema,
	target: targetSchema,
	maxRuns: z.number().int().min(1).max(10_000).optional(),
});

export type CreateCronRequest = z.infer<typeof createCronRequestSchema>;
export type CronTarget = z.infer<typeof targetSchema>;

export const jobStatusSchema = z.enum(["active", "paused", "exhausted", "deleted"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

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
}
