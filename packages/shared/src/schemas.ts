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
	notifyUrl: z
		.string()
		.url()
		.max(2048)
		.optional()
		.describe("Optional webhook that receives a POST after every execution with the run result"),
});

export type CreateCronRequest = z.infer<typeof createCronRequestSchema>;
export type CronTarget = z.infer<typeof targetSchema>;

export const jobStatusSchema = z.enum(["active", "paused", "exhausted", "deleted"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;
