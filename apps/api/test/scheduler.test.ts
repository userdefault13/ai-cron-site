import {
	createExecutionContext,
	createScheduledController,
	runDurableObjectAlarm,
	runInDurableObject,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { CronJobDO } from "../src/index";
import type { JobState } from "../src/scheduler";
import { getExecutions, getJob, getPayments, insertJob, rpc, stub, urlOf } from "./helpers";

/** Route every outbound fetch through a fake; nothing leaves the test process. */
function mockOutbound(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) =>
			handler(urlOf(input), init),
		);
}

async function storedAlarm(jobId: string): Promise<number | null> {
	return runInDurableObject(stub(jobId), (_instance, state) => state.storage.getAlarm());
}

async function storedJob(jobId: string): Promise<JobState | undefined> {
	return runInDurableObject(stub(jobId), (_instance, state) => state.storage.get<JobState>("job"));
}

async function runSweep() {
	const ctx = createExecutionContext();
	worker.scheduled(createScheduledController({ cron: "* * * * *" }), env, ctx);
	await waitOnExecutionContext(ctx);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("CronJobDO.init", () => {
	it("stores the job, schedules the first alarm and mirrors next_run_at to D1", async () => {
		const job = await insertJob();
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "POST" },
		});

		const alarm = await storedAlarm(job.id);
		expect(alarm).toBeGreaterThan(Date.now());
		expect((await getJob(job.id))?.next_run_at).toBe(alarm);
		expect(await storedJob(job.id)).toMatchObject({ jobId: job.id, status: "active" });
	});
});

describe("CronJobDO.alarm", () => {
	it("fires the webhook, records the execution, spends one credit and arms the next alarm", async () => {
		const job = await insertJob({
			credits: 3,
			target_method: "POST",
			target_body: '{"hello":"world"}',
		});
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: {
				url: job.target_url,
				method: "POST",
				headers: { "x-test": "1" },
				body: '{"hello":"world"}',
			},
		});
		const fetchSpy = mockOutbound(() => new Response("ok", { status: 200 }));

		expect(await runDurableObjectAlarm(stub(job.id))).toBe(true);

		expect(fetchSpy).toHaveBeenCalledTimes(1);
		const [input, init] = fetchSpy.mock.calls[0] ?? ["", undefined];
		expect(urlOf(input)).toBe(job.target_url);
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe('{"hello":"world"}');
		expect(init?.headers).toMatchObject({ "x-test": "1" });

		const executions = await getExecutions(job.id);
		expect(executions).toHaveLength(1);
		expect(executions[0]).toMatchObject({ ok: 1, status_code: 200, error: null });

		const row = await getJob(job.id);
		expect(row).toMatchObject({ credits: 2, status: "active", consecutive_failures: 0 });

		const nextAlarm = await storedAlarm(job.id);
		expect(nextAlarm).toBeGreaterThan(Date.now());
		expect(row?.next_run_at).toBe(nextAlarm);
	});

	it("marks the job exhausted and stops scheduling after the last credit is spent", async () => {
		const job = await insertJob({ credits: 1 });
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "POST" },
		});
		mockOutbound(() => new Response("ok", { status: 200 }));

		await runDurableObjectAlarm(stub(job.id));

		expect(await getJob(job.id)).toMatchObject({
			credits: 0,
			status: "exhausted",
			next_run_at: null,
		});
		expect(await storedAlarm(job.id)).toBeNull();
		expect((await storedJob(job.id))?.status).toBe("exhausted");
	});

	it("does not call the webhook when the job has no credits left", async () => {
		const job = await insertJob({ credits: 1 });
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "POST" },
		});
		await env.DB.prepare("UPDATE jobs SET credits = 0 WHERE id = ?").bind(job.id).run();
		const fetchSpy = mockOutbound(() => new Response("ok"));

		await runDurableObjectAlarm(stub(job.id));

		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await getExecutions(job.id)).toHaveLength(0);
		expect((await getJob(job.id))?.status).toBe("exhausted");
	});

	it("records a non-retryable 4xx once, counts the failure and keeps the schedule", async () => {
		const job = await insertJob({ credits: 3 });
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "POST" },
		});
		const fetchSpy = mockOutbound(() => new Response("nope", { status: 404 }));

		await runDurableObjectAlarm(stub(job.id));

		expect(fetchSpy).toHaveBeenCalledTimes(1); // 4xx is not retried
		expect((await getExecutions(job.id))[0]).toMatchObject({
			ok: 0,
			status_code: 404,
			error: "http 404",
		});
		expect(await getJob(job.id)).toMatchObject({
			credits: 2,
			consecutive_failures: 1,
			status: "active",
		});
		expect(await storedAlarm(job.id)).toBeGreaterThan(Date.now());
	});

	it("POSTs the run result to notifyUrl when one is set", async () => {
		const job = await insertJob({ credits: 2, notify_url: "https://notify.test/hook" });
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "GET" },
			notifyUrl: "https://notify.test/hook",
		});
		const fetchSpy = mockOutbound(() => new Response("ok", { status: 200 }));

		await runDurableObjectAlarm(stub(job.id));

		await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
		const notifyCall = fetchSpy.mock.calls.find(
			([input]) => urlOf(input) === "https://notify.test/hook",
		);
		expect(notifyCall).toBeDefined();
		expect(JSON.parse(String(notifyCall?.[1]?.body))).toMatchObject({
			type: "cron402.execution",
			jobId: job.id,
			ok: true,
			statusCode: 200,
		});
	});
});

describe("scheduled() sweeper", () => {
	it("re-arms a past-due active job whose alarm was lost", async () => {
		const job = await insertJob();
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "POST" },
		});
		// Simulate a lost alarm: no alarm in the DO, D1 says the run is 10 minutes overdue.
		await runInDurableObject(stub(job.id), (_instance, state) => state.storage.deleteAlarm());
		const overdue = Date.now() - 10 * 60 * 1000;
		await env.DB.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?")
			.bind(overdue, job.id)
			.run();

		await runSweep();

		const alarm = await storedAlarm(job.id);
		expect(alarm).toBeGreaterThan(Date.now());
		expect((await getJob(job.id))?.next_run_at).toBe(alarm);
	});

	it("leaves a job that is due but inside the 90s grace window alone", async () => {
		const job = await insertJob();
		await rpc(job.id).init({
			id: job.id,
			schedule: job.schedule,
			target: { url: job.target_url, method: "POST" },
		});
		await runInDurableObject(stub(job.id), (_instance, state) => state.storage.deleteAlarm());
		const justDue = Date.now() - 30_000;
		await env.DB.prepare("UPDATE jobs SET next_run_at = ? WHERE id = ?")
			.bind(justDue, job.id)
			.run();

		await runSweep();

		expect(await storedAlarm(job.id)).toBeNull();
		expect((await getJob(job.id))?.next_run_at).toBe(justDue);
	});

	it("recovers an orphan (active, next_run_at NULL, DO never initialised) from its D1 row", async () => {
		const job = await insertJob({
			target_method: "POST",
			target_headers: JSON.stringify({ authorization: "Bearer test-only" }),
			target_body: '{"ping":1}',
			notify_url: "https://notify.test/orphan",
		});
		expect(await storedJob(job.id)).toBeUndefined();

		await runSweep();

		expect(await storedJob(job.id)).toMatchObject({
			jobId: job.id,
			status: "active",
			schedule: job.schedule,
			notifyUrl: "https://notify.test/orphan",
			target: {
				url: job.target_url,
				method: "POST",
				headers: { authorization: "Bearer test-only" },
				body: '{"ping":1}',
			},
		});
		const alarm = await storedAlarm(job.id);
		expect(alarm).toBeGreaterThan(Date.now());
		expect((await getJob(job.id))?.next_run_at).toBe(alarm);
	});

	it("soft-deletes and scrubs an orphan whose DO init fails, keeping its payments", async () => {
		const job = await insertJob({
			target_url: "https://hook.test/path?token=secret-test-only",
			target_headers: JSON.stringify({ authorization: "Bearer test-only" }),
			target_body: "{}",
			notify_url: "https://notify.test/x",
		});
		await env.DB.prepare(
			"INSERT INTO payments (job_id, payer_address, amount_usd, runs, created_at) VALUES (?, ?, '0.008', 1, ?)",
		)
			.bind(job.id, job.payer_address, Date.now())
			.run();
		const realInit = CronJobDO.prototype.init;
		vi.spyOn(CronJobDO.prototype, "init").mockImplementation(async function (
			this: CronJobDO,
			args,
		) {
			if (args.id === job.id) throw new Error("simulated DO init failure");
			return realInit.call(this, args);
		});

		await runSweep();

		expect(await getJob(job.id)).toMatchObject({
			status: "deleted",
			next_run_at: null,
			target_headers: null,
			target_body: null,
			notify_url: null,
			target_url: "https://hook.test/path",
		});
		expect(await getPayments(job.id)).toHaveLength(1);
	});

	it("ignores paused jobs", async () => {
		const job = await insertJob({ status: "paused", next_run_at: null });

		await runSweep();

		expect(await storedJob(job.id)).toBeUndefined();
		expect((await getJob(job.id))?.status).toBe("paused");
	});
});
