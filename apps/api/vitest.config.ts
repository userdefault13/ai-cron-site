import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Throwaway test-only receiver address (no key, never funded).
const TEST_PAY_TO = "0x000000000000000000000000000000000000c402";

export default defineConfig(async () => {
	const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
	return {
		resolve: {
			alias: {
				"@cron402/shared": path.join(__dirname, "../../packages/shared/src/index.ts"),
			},
		},
		plugins: [
			cloudflareTest({
				main: "./src/index.ts",
				wrangler: { configPath: "./wrangler.jsonc" },
				miniflare: {
					d1Databases: ["DB"],
					// Every binding is pinned so local .dev.vars secrets never leak into tests
					// and CI behaves the same as a laptop.
					bindings: {
						TEST_MIGRATIONS: migrations,
						PAY_TO_ADDRESS: TEST_PAY_TO,
						X402_NETWORK: "eip155:8453",
						FACILITATOR_URL: "https://facilitator.test",
						SKIP_PAYMENTS: "0",
						CDP_API_KEY_ID: "",
						CDP_API_KEY_SECRET: "",
						MOLTBOOK_API_KEY: "",
						MOLTBOOK_HEARTBEAT_TOKEN: "",
					},
				},
			}),
		],
		test: {
			setupFiles: ["./test/apply-migrations.ts"],
		},
	};
});
