# mcp-builder-ui

An Agent Skill for building high-quality **MCP servers** — including the
interactive, in-chat UIs introduced by **MCP Apps** (SEP-1865).

It walks an AI coding agent through the whole lifecycle: research the API, design
the tools, implement the server in TypeScript or Python, optionally attach
`ui://` views that render inline in the conversation, then test and evaluate.

This is a fork of Anthropic's `mcp-builder` skill (Apache-2.0) with an added
MCP Apps phase. See [NOTICE](NOTICE) for the list of changes.

---

## What's inside

```
skills/mcp-builder-ui/
├── SKILL.md                        # 5-phase workflow
├── reference/
│   ├── mcp_best_practices.md       # naming, responses, pagination, transport, security
│   ├── node_mcp_server.md          # TypeScript / MCP SDK guide
│   ├── python_mcp_server.md        # Python / FastMCP guide
│   ├── mcp_apps_ui.md              # ← MCP Apps: ui:// resources, App SDK, theming, CSP
│   └── evaluation.md               # writing and running evaluations
└── scripts/
    ├── evaluation.py               # evaluation runner
    ├── connections.py              # MCP connection helpers
    ├── example_evaluation.xml
    └── requirements.txt
```

## The workflow

| Phase | What happens |
|---|---|
| 1 — Research & Planning | Study the target API and the MCP spec; pick tools; flag UI candidates |
| 2 — Implementation | Schemas, error handling, pagination, `structuredContent` |
| **3 — Interactive UI** | **Optional. Attach MCP Apps views via `ui://` resources** |
| 4 — Review & Test | Build, MCP Inspector, reference host for views |
| 5 — Evaluations | 10 verifiable questions, run with the bundled scripts |

## Why the UI phase

MCP tools return text and structured data. That's right for most tools — but not
for a chart, a map, a form or a media viewer. MCP Apps lets a tool publish an HTML
view as a `ui://` resource; the host renders it in a sandboxed iframe inline in
the conversation and exchanges JSON-RPC messages with it.

The skill treats UI as **strictly additive**: every App tool keeps its text
`content` fallback, so text-only hosts are never degraded.

What it covers that a rendering tutorial doesn't:

- **The conversational loop.** `updateModelContext` and `sendMessage`, so the model
  knows what the user selected in the view. Without this, the user clicks a point
  on your map, asks "what about this place?", and the model has no idea what
  "this" is. This is the difference between an app and a picture.
- **The silent failure modes.** `_meta.ui.csp` belongs in the `contents[]` objects
  returned by the read callback, not in the config object — put it in the wrong
  place and nothing errors, the app just can't reach the network. Same class of
  trap: handlers registered after `connect()`, missing initial `getHostContext()`,
  no `vite-plugin-singlefile`.
- **Production patterns.** Polling, offscreen pause via `IntersectionObserver`,
  chunked loading for payloads over host size limits, `viewUUID` state persistence,
  streaming partial input.
- **Signatures verified against the SDK sources**, not against prose docs — several
  of which disagree with each other.

Supported hosts include Claude, ChatGPT, VS Code, Goose, Postman and MCPJam.

## Install

### As a Claude Code plugin (recommended)

```
/plugin marketplace add FFZackFair92/mcp-builder-ui
/plugin install mcp-builder-ui@mcp-builder-ui
```

### Manually (any agent that supports Agent Skills)

```bash
git clone https://github.com/FFZackFair92/mcp-builder-ui.git
cp -r mcp-builder-ui/skills/mcp-builder-ui ~/.claude/skills/
```

For other agents, place `skills/mcp-builder-ui/` wherever your agent loads skills
from. See [agentskills.io](https://agentskills.io/) for the format.

### Verify

Ask your agent *"what skills do you have?"* — `mcp-builder-ui` should appear.

## Use it

Just ask:

- *"Build an MCP server for the Linear API"*
- *"Add an interactive UI to my MCP server's `list_issues` tool"*
- *"Turn this tool's output into a chart that renders in chat"*
- *"Write evaluations for my MCP server"*

## Requirements

The evaluation scripts need Python 3.10+ and the packages in
`skills/mcp-builder-ui/scripts/requirements.txt`. The MCP Apps phase assumes
Node 20+ and `@modelcontextprotocol/ext-apps`.

## Further reading

- [MCP specification](https://modelcontextprotocol.io/specification)
- [MCP Apps spec (SEP-1865, 2026-01-26)](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
- [MCP Apps SDK & examples](https://github.com/modelcontextprotocol/ext-apps)
- [MCP Apps Quickstart](https://apps.extensions.modelcontextprotocol.io/api/documents/Quickstart.html)

## License

Apache License 2.0 — see [LICENSE](LICENSE) and [NOTICE](NOTICE).
