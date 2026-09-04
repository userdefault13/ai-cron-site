# Agent skills

Drop-in skills that teach an agent how to use cron402. Copy the folder into the
project you want the agent to work in:

```bash
# Claude Code / Claude Desktop
cp -r skills/cron402 <your-project>/.claude/skills/cron402

# Cursor, Codex, and other SKILL.md readers
cp -r skills/cron402 <your-project>/.agent/skills/cron402

# straight from the web, no clone
curl -sL https://raw.githubusercontent.com/userdefault13/ai-cron-site/main/skills/cron402/SKILL.md \
  -o .claude/skills/cron402/SKILL.md
```

| Skill | What it covers |
|---|---|
| [`cron402`](cron402/SKILL.md) | Scheduling, checking, topping up and cancelling recurring webhook jobs through the `cron402-mcp` MCP server, including how to install that server. |

The skill assumes the `cron402` MCP server is connected; the last section of
`SKILL.md` explains how to add it if it is not.
