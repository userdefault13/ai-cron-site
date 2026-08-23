export interface Env {
	DB: D1Database;
	CRON_JOB_DO: DurableObjectNamespace;
	PAY_TO_ADDRESS: string;
	X402_NETWORK: string;
	FACILITATOR_URL?: string;
	SKIP_PAYMENTS?: string;
	CDP_API_KEY_ID?: string;
	CDP_API_KEY_SECRET?: string;
}

/** Typed facade over a CronJobDO stub (RPC-style methods). */
export interface CronJobDOStub {
	init(job: {
		id: string;
		schedule: string;
		target: import("@cron402/shared").CronTarget;
	}): Promise<void>;
	kick(): Promise<void>;
	resume(): Promise<void>;
	cancel(): Promise<void>;
}
