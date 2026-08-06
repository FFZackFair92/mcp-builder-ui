# 🎨 MCP Apps — Interactive UI Guide

Guide for adding **interactive, in-chat user interfaces** to an MCP server using
the MCP Apps extension (SEP-1865, stable `2026-01-26`).

MCP Apps lets a tool declare an HTML view published as a `ui://` resource. The
host fetches that resource and renders it inline in the conversation inside a
sandboxed iframe, then exchanges messages with it over MCP's JSON-RPC.

---

## 1. When to add a UI

UI is an **enhancement, never a replacement**. A tool must keep working for
text-only hosts.

| Tool output | UI benefit | Example |
|---|---|---|
| Structured data, lists, tables | High — sortable/filterable table | search results, records |
| Metrics over time | High — charts, gauges, dashboards | analytics, system stats |
| Media / rich content | High — viewer, player, renderer | maps, PDFs, 3D, video |
| Simple text / confirmations | Low — plain text is better | "file created" |
| Data consumed by another view | Consider **app-only** tool | polling, pagination, chunk loading |

Decide per tool, not per server. A typical server has a mix of App tools and
plain tools.

---

## 2. Architecture

1. **Tool definition** — the tool declares its view via `_meta.ui.resourceUri`
2. **Tool call** — the model calls the tool
3. **Host renders** — the host reads the `ui://` resource and mounts it in a
   sandboxed iframe
4. **Bidirectional communication** — the host pushes tool input/result into the
   view; the view can call server tools back through the host

MIME type for the view resource: `text/html;profile=mcp-app`
(exported as `RESOURCE_MIME_TYPE`).

---

## 3. Setup

```bash
npm install @modelcontextprotocol/ext-apps
npm install -D vite vite-plugin-singlefile
```

Add framework deps if needed (`react`, `vue`, `svelte`, …). Always install with
`npm install` — never write version numbers from memory.

### SDK entry points

| Import path | Purpose |
|---|---|
| `@modelcontextprotocol/ext-apps` | Build the view (`App`, `PostMessageTransport`, style helpers) |
| `@modelcontextprotocol/ext-apps/react` | React hooks (`useApp`, `useHostStyles`, …) |
| `@modelcontextprotocol/ext-apps/server` | Server registration (`registerAppTool`, `registerAppResource`, `getUiCapability`) |
| `@modelcontextprotocol/ext-apps/app-bridge` | Host-side embedding (only if writing a host) |

---

## 4. Build pipeline

The view must ship as **one self-contained HTML file** — external asset URLs do
not resolve inside the sandboxed iframe.

`vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    outDir: "dist",
    rollupOptions: { input: "mcp-app.html" }, // one entry per distinct view
  },
});
```

`mcp-app.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MCP App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/mcp-app.ts"></script>
  </body>
</html>
```

`package.json` — the UI must build **before** the server bundles it:

```json
{
  "scripts": {
    "build:ui": "vite build",
    "build:server": "tsc",
    "build": "npm run build:ui && npm run build:server",
    "serve": "tsx server.ts"
  }
}
```

---

## 5. Server side

### Convert a plain tool into an App tool

Before:

```typescript
server.tool("my-tool", { param: z.string() }, async (args) => {
  const data = await fetchData(args.param);
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
});
```

After:

```typescript
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

const resourceUri = "ui://my-tool/mcp-app.html";

registerAppTool(
  server,
  "my-tool",
  {
    description: "Shows data with an interactive UI",
    inputSchema: { param: z.string() },
    _meta: { ui: { resourceUri } },
  },
  async (args) => {
    const data = await fetchData(args.param);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }], // fallback for text-only hosts
      structuredContent: { data },                             // what the view renders
    };
  },
);
```

### Register the view resource

```typescript
import fs from "node:fs/promises";
import path from "node:path";

registerAppResource(
  server,
  { uri: resourceUri, name: "My Tool UI", mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(
      path.resolve(import.meta.dirname, "dist", "mcp-app.html"),
      "utf-8",
    );
    return { contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
  },
);
```

Several tools may share one `resourceUri` and one resource registration.

### App-only helper tools

Tools the view calls but the model should not invoke directly (polling,
pagination, chunk loading):

```typescript
registerAppTool(
  server,
  "poll-data",
  {
    description: "Polls latest data for the UI",
    _meta: { ui: { resourceUri, visibility: ["app"] } },
  },
  async () => ({ content: [{ type: "text", text: JSON.stringify(await getLatestData()) }] }),
);
```

The view calls it with `app.callServerTool("poll-data", {})`.

### CSP — external domains

Anything the view loads from outside must be declared, or the sandbox blocks it:

```typescript
registerAppResource(
  server,
  {
    uri: resourceUri,
    name: "My Tool UI",
    mimeType: RESOURCE_MIME_TYPE,
    _meta: {
      ui: {
        connectDomains: ["api.example.com"],   // fetch / XHR / WebSocket
        resourceDomains: ["cdn.example.com"],  // scripts, styles, images, fonts
        frameDomains: ["embed.example.com"],   // nested iframes
      },
    },
  },
  async () => { /* ... */ },
);
```

### Graceful degradation

Register the App tool only when the client advertises UI support:

```typescript
import { getUiCapability, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

server.server.oninitialized = () => {
  const uiCap = getUiCapability(server.server.getClientCapabilities());

  if (uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
    registerAppTool(server, "my-tool", { description: "…", _meta: { ui: { resourceUri } } }, appHandler);
  } else {
    server.tool("my-tool", "…", { param: z.string() }, plainHandler);
  }
};
```

---

## 6. View side

**Register every handler before `app.connect()`** — messages that arrive before
a handler is attached are lost.

```typescript
import {
  App,
  PostMessageTransport,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from "@modelcontextprotocol/ext-apps";

const app = new App({ name: "My App", version: "1.0.0" });

app.ontoolinput = (params) => {
  // params.arguments, params.structuredContent → initial render
};

app.ontoolresult = (result) => {
  // final tool result → update the view
};

app.onhostcontextchanged = (ctx) => {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
};

app.onteardown = async () => ({});

await app.connect(new PostMessageTransport());
```

React equivalent: `useApp()` + `useHostStyles()` from
`@modelcontextprotocol/ext-apps/react`.

### Streaming partial input

Show a preview while the model is still generating the tool call:

```typescript
app.ontoolinputpartial = (params) => {
  // params.arguments is healed partial JSON — always valid
};
app.ontoolinput = (params) => {
  // final, complete input → full render
};
```

### Host styling

Never hardcode colors or fonts. Use the host's CSS variables so the view matches
the surrounding chat in light and dark mode:

```css
.container {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-primary);
  font-family: var(--font-sans);
  border-radius: var(--border-radius-md);
}
```

Variable groups: `--color-background-*`, `--color-text-*`, `--color-border-*`,
`--font-sans`, `--font-mono`, `--font-text-*-size`, `--font-heading-*-size`,
`--border-radius-*`. Full list in the SDK's `src/spec.types.ts`.

### Fullscreen

```typescript
app.onhostcontextchanged = (ctx) => {
  if (ctx.availableDisplayModes?.includes("fullscreen")) showFullscreenButton();
  if (ctx.displayMode) container.classList.toggle("fullscreen", ctx.displayMode === "fullscreen");
};

const result = await app.requestDisplayMode({ mode: "fullscreen" });
```

---

## 7. Testing

```bash
# Terminal 1 — your server
npm run build && npm run serve

# Terminal 2 — reference host
git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host && npm install
SERVERS='["http://localhost:3001/mcp"]' npm start
# open http://localhost:8080
```

Verify:

1. Plain tools still return text output
2. App tools render their view in the iframe
3. `ontoolinput` fires with the tool arguments
4. `ontoolresult` fires with the tool result
5. Theme, fonts and colors follow the host
6. The text `content` fallback is still sensible on a text-only host

---

## 8. Common mistakes

1. Dropping the text `content` fallback — breaks every non-UI host
2. Registering handlers **after** `app.connect()`
3. Omitting `vite-plugin-singlefile` — assets 404 inside the sandbox
4. Referencing a `resourceUri` with no matching `registerAppResource`
5. Hardcoding colors/fonts instead of host CSS variables
6. Ignoring `ctx.safeAreaInsets` — content clipped on mobile hosts
7. Loading external CDNs without declaring `resourceDomains` / `connectDomains`
8. Putting model-facing logic in the view — the model can't see the DOM; anything
   it must reason about belongs in `content` / `structuredContent`

---

## 9. Evaluations with a UI

The evaluation questions from Phase 4 stay **text-based**: they test whether the
model can accomplish tasks with the tools. The view is not part of the answer
path. Verify the UI separately with the manual checklist in §7.

---

## 10. Reference links

- Spec (stable 2026-01-26): `https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx`
- Quickstart: `https://apps.extensions.modelcontextprotocol.io/api/documents/Quickstart.html`
- API docs: `https://apps.extensions.modelcontextprotocol.io/api/`
- Examples (map, PDF, system-monitor, charts, framework starters): `https://github.com/modelcontextprotocol/ext-apps/tree/main/examples`
- Clone pinned SDK source for JSDoc reference:
  ```bash
  git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 \
    https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
  ```
