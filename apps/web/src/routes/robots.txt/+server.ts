import type { RequestHandler } from "./$types";

export const prerender = true;

const AGENT_CRAWLERS = [
	"GPTBot",
	"OAI-SearchBot",
	"ChatGPT-User",
	"ClaudeBot",
	"Claude-Web",
	"Claude-SearchBot",
	"anthropic-ai",
	"PerplexityBot",
	"Google-Extended",
	"CCBot",
	"Bytespider",
];

function render(): string {
	const lines: string[] = ["# cron402 — open to human and agent crawlers alike"];
	for (const bot of AGENT_CRAWLERS) {
		lines.push(`User-agent: ${bot}`, "Allow: /");
	}
	lines.push("User-agent: *", "Allow: /", "", `Sitemap: none`);
	return lines.join("\n");
}

export const GET: RequestHandler = () =>
	new Response(render(), {
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
