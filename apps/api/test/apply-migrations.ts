import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Setup files run outside per-test storage isolation, so this is idempotent.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
