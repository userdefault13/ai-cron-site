import { DurableObject } from "cloudflare:workers";
import {
	type CronTarget,
	MAX_EXECUTIONS_RETAINED,
	MAX_RETRIES,
	RETENTION_DAYS,
	WEBHOOK_TIMEOUT_SECONDS,
} from "@cron402/shared";
import { parseExpression } from "cron-parser";
import type { Env } from "./types";

const RETRY_BACKOFF_MS = [1000, 3000, 8000];

export interface JobState {
	jobId: string;
	schedule: string;
	target: CronTarget;
	status: "active" | "paused" | "exhausted" | "deleted";
	notifyUrl?: string | null;
}

export function nextRunFrom(schedule: string, after?: Date): number | null {
	try {
		const interval = parseExpression(schedule, {
			currentDate: after ?? new Date(),
			tz: "UTC",
		});
		return interval.next().getTime();
	} catch {
		return null;
	}
}

export class CronJobDO extends DurableObject<Env> {
	declare readonly ctx: DurableObjectState<Env>;
	declare readonly env: Env;

	async init(job: {
		id: string;
		schedule: string;
		target: CronTarget;
		notifyUrl?: string | null;
	}): Promise<void> {
		await this.ctx.storage.put<JobState>("job", {
			jobId: job.id,
			schedule: job.schedule,
			target: job.target,
			status: "active",
			notifyUrl: job.notifyUrl ?? null,
		});
		const next = nextRunFrom(job.schedule);
		if (next) {
			await this.ctx.storage.setAlarm(next);
			await this.setNextRunInDb(job.id, next);
		}
	}

	async kick(): Promise<void> {
		const job = await this.ctx.storage.get<JobState>("job");
		if (job?.status !== "active") return;
		const alarm = await this.ctx.storage.getAlarm();
		if (alarm) return;
		const next = nextRunFrom(job.schedule);
		if (next) {
			await this.ctx.storage.setAlarm(next);
			await this.setNextRunInDb(job.jobId, next);
		}
	}

	async resume(): Promise<void> {
		await this.reactivate();
	}

	async cancel(): Promise<void> {
		const job = await this.ctx.storage.get<JobState>("job");
		if (!job) return;
		job.status = "deleted";
		await this.ctx.storage.put("job", job);
		await this.ctx.storage.deleteAlarm();
	}

	private async reactivate(): Promise<void> {
		const job = await this.ctx.storage.get<JobState>("job");
		if (!job || job.status === "active" || job.status === "deleted") return;
		const next = nextRunFrom(job.schedule);
		job.status = "active";
		await this.ctx.storage.put("job", job);
		if (next) {
			await this.ctx.storage.setAlarm(next);
			await this.setNextRunInDb(job.jobId, next);
		}
	}

	async alarm(): Promise<void> {
		const job = await this.ctx.storage.get<JobState>("job");
		if (job?.status !== "active") return;

		const row = await this.env.DB.prepare("SELECT credits FROM jobs WHERE id = ?")
			.bind(job.jobId)
			.first<{ credits: number }>();
		if (!row || row.credits <= 0) {
			await this.pause(job, row ? "exhausted" : "paused");
			return;
		}

		const result = await this.fireWebhook(job.target);

		await this.recordExecution(job.jobId, result);
		await this.consumeCredit(job.jobId);

		if (job.notifyUrl) {
			this.ctx.waitUntil(
				this.notify(job.notifyUrl, {
					type: "cron402.execution",
					jobId: job.jobId,
					runAt: Date.now(),
					ok: result.ok,
					attempts: result.attempts,
					statusCode: result.statusCode,
					error: result.error,
					durationMs: result.durationMs,
				}),
			);
		}

		if (!result.ok) {
			const updated = await this.env.DB.prepare(
				"UPDATE jobs SET consecutive_failures = consecutive_failures + 1 WHERE id = ? RETURNING consecutive_failures",
			)
				.bind(job.jobId)
				.first<{ consecutive_failures: number }>();
			if ((updated?.consecutive_failures ?? 0) >= MAX_RETRIES) {
				await this.pause(job, "paused");
				return;
			}
		} else {
			await this.env.DB.prepare("UPDATE jobs SET consecutive_failures = 0 WHERE id = ?")
				.bind(job.jobId)
				.run();
		}

		const remaining = await this.env.DB.prepare("SELECT credits FROM jobs WHERE id = ?")
			.bind(job.jobId)
			.first<{ credits: number }>();
		const next = nextRunFrom(job.schedule);
		if (next && (remaining?.credits ?? 0) > 0) {
			await this.ctx.storage.setAlarm(next);
			await this.setNextRunInDb(job.jobId, next);
		} else {
			await this.pause(job, (remaining?.credits ?? 0) <= 0 ? "exhausted" : "paused");
		}
	}

	private async notify(url: string, payload: Record<string, unknown>): Promise<void> {
		try {
			await fetch(url, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(payload),
				signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_SECONDS * 1000),
			});
		} catch {
			// notifications are best-effort; never affect scheduling
		}
	}

	private async fireWebhook(target: CronTarget): Promise<{
		ok: boolean;
		attempts: number;
		statusCode: number | null;
		error: string | null;
		durationMs: number;
	}> {
		let lastError: string | null = null;
		for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
			if (attempt > 0) {
				await sleep(RETRY_BACKOFF_MS[attempt] ?? 8000);
			}
			const start = Date.now();
			try {
				const res = await fetch(target.url, {
					method: target.method,
					headers: { "content-type": "application/json", ...(target.headers ?? {}) },
					body: target.method === "POST" ? (target.body ?? "{}") : undefined,
					signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_SECONDS * 1000),
				});
				// drain body to free the connection without retaining it
				await res.arrayBuffer().catch(() => {});
				if (res.ok) {
					return {
						ok: true,
						attempts: attempt + 1,
						statusCode: res.status,
						error: null,
						durationMs: Date.now() - start,
					};
				}
				lastError = `http ${res.status}`;
				if (res.status >= 400 && res.status < 500 && res.status !== 429) {
					// client errors will not fix themselves on retry
					return {
						ok: false,
						attempts: attempt + 1,
						statusCode: res.status,
						error: lastError,
						durationMs: Date.now() - start,
					};
				}
			} catch (err) {
				lastError = err instanceof Error ? err.message.slice(0, 500) : "unknown error";
			}
		}
		return {
			ok: false,
			attempts: MAX_RETRIES,
			statusCode: null,
			error: lastError,
			durationMs: 0,
		};
	}

	private async recordExecution(
		jobId: string,
		result: { ok: boolean; statusCode: number | null; error: string | null; durationMs: number },
	): Promise<void> {
		const now = Date.now();
		const db = this.env.DB;
		await db
			.prepare(
				"INSERT INTO executions (job_id, run_at, ok, status_code, error, duration_ms) VALUES (?, ?, ?, ?, ?, ?)",
			)
			.bind(jobId, now, result.ok ? 1 : 0, result.statusCode, result.error, result.durationMs)
			.run();
		const cutoff = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
		await db
			.prepare(
				`DELETE FROM executions WHERE job_id = ? AND (
					run_at < ?
					OR rowid NOT IN (
						SELECT rowid FROM executions WHERE job_id = ? ORDER BY run_at DESC LIMIT ${MAX_EXECUTIONS_RETAINED}
					)
				)`,
			)
			.bind(jobId, cutoff, jobId)
			.run();
	}

	private async consumeCredit(jobId: string): Promise<void> {
		await this.env.DB.prepare("UPDATE jobs SET credits = MAX(credits - 1, 0) WHERE id = ?")
			.bind(jobId)
			.run();
	}

	private async setNextRunInDb(jobId: string, next: number): Promise<void> {
		await this.env.DB.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?")
			.bind(next, jobId)
			.run();
	}

	private async pause(job: JobState, status: "paused" | "exhausted"): Promise<void> {
		job.status = status;
		await this.ctx.storage.put("job", job);
		await this.env.DB.prepare("UPDATE jobs SET status = ?, next_run_at = NULL WHERE id = ?")
			.bind(status, job.jobId)
			.run();
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
