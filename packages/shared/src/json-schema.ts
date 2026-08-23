import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { createCronRequestSchema } from "./schemas.js";

export const executionViewSchema = z.object({
	id: z.number().describe("Execution row id"),
	jobId: z.string().uuid(),
	runAt: z.number().int().describe("Unix ms when the run was attempted"),
	ok: z.number().int().min(0).max(1).describe("1 if the webhook returned a 2xx status"),
	statusCode: z.number().int().nullable().describe("HTTP status of the last attempt"),
	error: z.string().nullable().describe("Error summary from the last attempt"),
	durationMs: z.number().int().describe("Duration of the successful/last attempt in ms"),
});

export const jobViewSchema = z.object({
	id: z.string().uuid(),
	payerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
	schedule: z.string().describe("Standard 5-field cron expression (UTC)"),
	target: z.object({ url: z.string().url(), method: z.string() }),
	credits: z.number().int().describe("Remaining prepaid runs"),
	status: z.enum(["active", "paused", "exhausted", "deleted"]),
	nextRunAt: z.number().int().nullable().describe("Unix ms of next scheduled fire"),
	createdAt: z.number().int(),
});

export const createCronResponseSchema = z.object({
	id: z.string().uuid(),
	statusUrl: z.string(),
	credits: z.number().int(),
});

export const topupRequestSchema = z.object({
	jobId: z.string().uuid().describe("Job to credit"),
});

export const topupResponseSchema = z.object({
	jobId: z.string(),
	runsAdded: z.number().int(),
	credits: z.number().int().optional(),
});

export const errorResponseSchema = z.object({
	error: z.string(),
	issues: z.record(z.unknown()).optional(),
});

function toJson(schema: z.ZodTypeAny): Record<string, unknown> {
	return zodToJsonSchema(schema, {
		target: "openApi3",
		$refStrategy: "none",
	}) as Record<string, unknown>;
}

export const createCronRequestJsonSchema = toJson(createCronRequestSchema);
export const createCronResponseJsonSchema = toJson(createCronResponseSchema);
export const jobViewJsonSchema = toJson(jobViewSchema);
export const executionViewJsonSchema = toJson(executionViewSchema);
export const topupRequestJsonSchema = toJson(topupRequestSchema);
export const topupResponseJsonSchema = toJson(topupResponseSchema);
export const errorResponseJsonSchema = toJson(errorResponseSchema);
