import type { RequestHandler } from "./$types";

export const prerender = true;

const SITE = "https://agentcron.site";

// Explicit agent / AI crawler UAs (in addition to User-agent: *)
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
	"Applebot-Extended",
	"Amazonbot",
	"meta-externalagent",
	"FacebookBot",
	"Diffbot",
	"CCBot",
	"Bytespider",
	"cohere-ai",
	"YouBot",
];

function render(): string {
	const lines: string[] = [
		"# cron402 — open to human and agent crawlers alike",
		`# Machine-readable summary: ${SITE}/llms.txt`,
		`# Agent skill file: ${SITE}/skill.md`,
		"",
	];
	for (const bot of AGENT_CRAWLERS) {
		lines.push(`User-agent: ${bot}`, "Allow: /", "");
	}
	lines.push(
		"User-agent: *",
		"Allow: /",
		"Allow: /llms.txt",
		"Allow: /skill.md",
		"Allow: /docs",
		"Allow: /sitemap.xml",
		"",
		`Sitemap: ${SITE}/sitemap.xml`,
	);
	return lines.join("\n") + "\n";
}

export const GET: RequestHandler = () =>
	new Response(render(), {
		headers: { "content-type": "text/plain; charset=utf-8" },
	});
