import type { RequestHandler } from "./$types";

export const prerender = true;

const SITE = "https://web-seven-ecru-65.vercel.app";

const entries = [
	{ path: "/", priority: "1.0", changefreq: "weekly" },
	{ path: "/docs", priority: "0.9", changefreq: "weekly" },
	{ path: "/dashboard", priority: "0.5", changefreq: "monthly" },
];

export const GET: RequestHandler = () => {
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
	.map(
		(e) =>
			`\t<url><loc>${SITE}${e.path}</loc><changefreq>${e.changefreq}</changefreq><priority>${e.priority}</priority></url>`,
	)
	.join("\n")}
</urlset>`;
	return new Response(body, {
		headers: { "content-type": "application/xml; charset=utf-8" },
	});
};
