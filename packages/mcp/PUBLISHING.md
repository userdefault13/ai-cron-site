# Publishing cron402-mcp

End-to-end release runbook for npm and the [MCP Registry](https://registry.modelcontextprotocol.io).

## One-time setup

| Prerequisite | Action |
|---|---|
| npm account | `userdefault` owns [`cron402-mcp`](https://www.npmjs.com/package/cron402-mcp) |
| npm automation token | [npmjs.com/settings/~/tokens](https://www.npmjs.com/settings/~/tokens) → Granular Access Token → scope `cron402-mcp`, Read and Write |
| GitHub secret | Add `NPM_TOKEN` to repo Settings → Secrets → Actions |
| MCP publisher CLI | `npm install -g @modelcontextprotocol/publisher` |
| MCP Registry auth | `mcp-publisher login github` (must match `userdefault13` namespace) |

Local manual publishes can use `.npmrc.local` (gitignored) with `//registry.npmjs.org/:_authToken=...`.

## Version sync

On every release, update all three:

| File | Field |
|---|---|
| `package.json` | `"version"` |
| `server.json` | `"version"` and `packages[0].version` |
| Git tag | `cron402-mcp-v{version}` |

## First release (manual)

```bash
# Preflight
pnpm --filter cron402-mcp build
pnpm --filter cron402-mcp check
cd packages/mcp && mcp-publisher validate server.json

# Inspect tarball
npm pack --dry-run
# Expect: dist/index.js, package.json, README.md (with mcpName)

# Publish to npm
npm publish --access public

# Verify npm
npm view cron402-mcp version
npm view cron402-mcp mcpName

# Smoke test
CRON402_NETWORK=eip155:84532 CRON402_PRIVATE_KEY=0x... npx -y cron402-mcp@VERSION

# Publish to MCP Registry (npm must be live first)
mcp-publisher validate server.json
mcp-publisher publish
```

## Subsequent releases (CI + manual registry)

1. Bump versions in `package.json` and `server.json`
2. Merge to `main`
3. Create a GitHub Release with tag `cron402-mcp-v{version}` → CI publishes to npm
4. After CI succeeds, run `mcp-publisher publish` from `packages/mcp/`

## Troubleshooting

| Problem | Fix |
|---|---|
| `mcpName` mismatch | `package.json` mcpName must equal `server.json` name |
| Registry validation fails on description | Trim to ≤100 characters |
| `403` on npm publish | Check token scope and maintainer access |
| Registry ownership verification fails | npm package must be public and live before registry publish |
| Version already published | Bump patch version |

## Verification checklist

- [ ] `npm view cron402-mcp version` matches release
- [ ] `npm view cron402-mcp mcpName` returns `io.github.userdefault13/cron402-mcp`
- [ ] `npm view cron402-mcp readme` renders install instructions
- [ ] `mcp-publisher validate server.json` passes
- [ ] Server appears at registry.modelcontextprotocol.io (search "cron402")
- [ ] `npx -y cron402-mcp@VERSION` starts successfully
