import type { Hono } from "hono";
import type { Env } from "./types";

const MOLTBOOK_BASE = "https://www.moltbook.com/api/v1";

export function registerMoltbookRoutes(app: Hono<{ Bindings: Env }>): void {
	// Fired by cron402 itself every 8 hours (dogfood). Token-gated.
	app.post("/v1/moltbook/heartbeat", async (c) => {
		const token = c.req.header("x-heartbeat-key");
		if (!token || !c.env.MOLTBOOK_HEARTBEAT_TOKEN || token !== c.env.MOLTBOOK_HEARTBEAT_TOKEN) {
			return c.json({ error: "unauthorized" }, 401);
		}
		if (!c.env.MOLTBOOK_API_KEY) {
			return c.json({ error: "MOLTBOOK_API_KEY not configured" }, 500);
		}

		const res = await fetch(`${MOLTBOOK_BASE}/home`, {
			headers: {
				accept: "application/json",
				authorization: `Bearer ${c.env.MOLTBOOK_API_KEY}`,
			},
			signal: AbortSignal.timeout(15_000),
		});
		// biome-ignore lint/suspicious/noExplicitAny: Moltbook /home payload is loosely typed
		const body = (await res.json().catch(() => null)) as Record<string, any> | null;
		if (!res.ok) {
			return c.json({ error: "moltbook /home failed", httpStatus: res.status }, 502);
		}

		// biome-ignore lint/suspicious/noExplicitAny: same loose payload shape
		const data: Record<string, any> = body?.data ?? body ?? {};
		const summary = {
			type: "cron402.moltbook-heartbeat",
			checkedAt: Date.now(),
			unreadNotifications: data?.agent?.unread_notification_count ?? 0,
			activityOnPosts: (data?.activity_on_your_posts ?? []).map((a: Record<string, unknown>) => ({
				postId: a.post_id,
				title: a.post_title,
				submolt: a.submolt_name,
				newCount: a.new_notification_count,
				latestCommenters: a.latest_commenters,
				preview: a.preview,
				readUrl: `${MOLTBOOK_BASE}/posts/${a.post_id}/comments?sort=new`,
			})),
			announcement: data?.latest_moltbook_announcement
				? {
						title: data.latest_moltbook_announcement.title,
						preview: data.latest_moltbook_announcement.preview,
					}
				: null,
			suggestions: data?.suggested_actions ?? [],
		};
		return c.json(summary);
	});
}
