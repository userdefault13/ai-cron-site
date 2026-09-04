import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RememberedJob {
	jobId: string;
	schedule: string;
	description: string;
	url: string;
	createdAt: string;
	network: string;
	apiUrl: string;
}

const STATE_FILE = join(process.env.CRON402_STATE_DIR ?? join(homedir(), ".cron402"), "jobs.json");

/**
 * cron402 has no "list my jobs" endpoint — job ids only exist in the create
 * response. Agents lose them, so every created job is written here and
 * `list_crons` reads it back.
 */
function readAll(): RememberedJob[] {
	try {
		if (!existsSync(STATE_FILE)) return [];
		const parsed: unknown = JSON.parse(readFileSync(STATE_FILE, "utf8"));
		return Array.isArray(parsed) ? (parsed as RememberedJob[]) : [];
	} catch {
		return [];
	}
}

export function rememberJob(job: RememberedJob): void {
	try {
		mkdirSync(dirname(STATE_FILE), { recursive: true });
		const jobs = readAll().filter((j) => j.jobId !== job.jobId);
		jobs.push(job);
		writeFileSync(STATE_FILE, JSON.stringify(jobs.slice(-500), null, 2));
	} catch {
		// Remembering is a convenience; never fail a paid create over it.
	}
}

export function forgetJob(jobId: string): void {
	try {
		if (!existsSync(STATE_FILE)) return;
		writeFileSync(
			STATE_FILE,
			JSON.stringify(
				readAll().filter((j) => j.jobId !== jobId),
				null,
				2,
			),
		);
	} catch {
		// ignore
	}
}

export function rememberedJobs(apiUrl: string): RememberedJob[] {
	return readAll().filter((j) => j.apiUrl === apiUrl);
}

export const stateFilePath = STATE_FILE;
