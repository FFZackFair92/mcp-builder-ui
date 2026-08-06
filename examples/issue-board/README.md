# Issue Board — a worked MCP App

A minimal, runnable MCP server with an interactive view, written to demonstrate
the principles in
[`app_design.md`](../../skills/mcp-builder-ui/reference/app_design.md) rather than
to show off rendering.

Data is in-memory (`data.ts`), so there is nothing to configure.

## Run it

```bash
npm install
npm run build
npm run serve          # http://localhost:3001/mcp
```

Against the reference host:

```bash
git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host && npm install
SERVERS='["http://localhost:3001/mcp"]' npm start     # http://localhost:8080
```

In Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "issue-board": {
      "command": "bash",
      "args": ["-c", "cd /path/to/issue-board && npm run build >&2 && node dist/main.js --stdio"]
    }
  }
}
```

## What each file demonstrates

| File | Shows |
|---|---|
| `server.ts` | `summarize()` — the model's standalone answer; `registerAppTool` with `_meta.ui.resourceUri`; an app-only tool (`visibility: ["app"]`); `registerAppResource` with the positional signature; `viewUUID` minted per call; where `csp` would go |
| `src/mcp-app.ts` | Handlers registered before `connect()`; initial `getHostContext()`; debounced `updateModelContext`; `sendMessage` on explicit intent only; `callServerTool`; error reported back to the model; `localStorage` keyed by `viewUUID`; `onteardown` |
| `src/style.css` | Host CSS variables with fallbacks, both themes |
| `vite.config.ts` | `vite-plugin-singlefile` — mandatory |
| `main.ts` | Stateless HTTP plus stdio from one entry point |

## The point of the example

Call `list_issues` and read what the model gets:

> 8 open issues. 4 are P0, of which 3 have been open more than 14 days (#221 Auth
> timeout on SSO refresh; #245 Payment retry loops on 402; #260 CSV export
> truncates at 10k rows). 2 issues are unassigned (#288, #301).

That sentence is the deliverable. It answers "what's blocking the release?"
**with the view switched off** — which is the first question in the review rubric,
and the one most MCP Apps fail.

The view then adds what the sentence can't: scanning, filtering, and two actions.
And every meaningful thing the user does there — changing the filter, closing an
issue — goes back to the model through `updateModelContext`, so the conversation
stays coherent with what's on screen.

Try it: filter to P0, close #245, then ask Claude what's still blocking the
release. It should know the issue is gone and that you're looking at P0s only.
Comment out the `updateModelContext` calls and try again — that difference is the
entire lesson.

## Verified

`npx tsc --noEmit` and `npx vite build` pass. `initialize`, `tools/list`,
`tools/call` (both tools) and `resources/read` were exercised against a running
instance; the view resource is served as `text/html;profile=mcp-app`.
