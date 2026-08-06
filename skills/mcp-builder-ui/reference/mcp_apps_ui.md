# 🎨 MCP Apps — Interactive UI Guide

Building **interactive, in-chat user interfaces** for an MCP server using the
MCP Apps extension (SEP-1865, stable `2026-01-26`).

A tool declares an HTML view published as a `ui://` resource. The host fetches it
and renders it inline in the conversation inside a sandboxed iframe, then
exchanges JSON-RPC messages with it.

> **Every API signature in this guide is taken from the SDK's type-checked
> examples** (`src/app.examples.ts`, `src/server/index.examples.ts`). Prose docs
> around the ecosystem disagree on several of them — when in doubt, clone the SDK
> (see §12) and read those two files, not blog posts.

---

## 1. When to add a UI

UI is an **enhancement, never a replacement**. A tool must keep working for
text-only hosts.

| Tool output | UI benefit | Example |
|---|---|---|
| Structured data, lists, tables | High — sortable/filterable table | search results, records |
| Metrics over time | High — charts, gauges, dashboards | analytics, system stats |
| Media / rich content | High — viewer, player, renderer | maps, PDFs, 3D, video |
| Something the user *manipulates* | Highest — the model can't drag a slider | budget allocator, canvas |
| Simple text / confirmations | Low — plain text is better | "file created" |
| Data consumed by another view | Consider **app-only** tool | polling, pagination, chunks |

Decide per tool, not per server. A typical server mixes App tools and plain tools.

---

## 2. Architecture

1. **Tool definition** — the tool declares its view via `_meta.ui.resourceUri`
2. **Tool call** — the model calls the tool
3. **Host renders** — the host reads the `ui://` resource and mounts it in a
   sandboxed iframe
4. **Bidirectional communication** — the host pushes tool input/result into the
   view; the view calls server tools, reads resources, updates model context and
   sends messages back through the host

MIME type of the view resource: `text/html;profile=mcp-app`, exported as
`RESOURCE_MIME_TYPE`.

---

## 3. Setup

```bash
npm install @modelcontextprotocol/ext-apps @modelcontextprotocol/sdk zod
npm install -D typescript tsx vite vite-plugin-singlefile
```

Add framework deps if needed (`react`, `vue`, `svelte`, …). Always install with
`npm install` — never write version numbers from memory. Use `tsx` to run the
TypeScript server unless the user prefers otherwise.

### SDK entry points

| Import path | Purpose |
|---|---|
| `@modelcontextprotocol/ext-apps` | Build the view (`App`, `PostMessageTransport`, style helpers) |
| `@modelcontextprotocol/ext-apps/react` | React hooks (`useApp`, `useHostStyles`, …) |
| `@modelcontextprotocol/ext-apps/server` | Server registration (`registerAppTool`, `registerAppResource`, `getUiCapability`) |
| `@modelcontextprotocol/ext-apps/app-bridge` | Host-side embedding (only if writing a host) |

---

## 4. Build pipeline

The view must ship as **one self-contained HTML file** — it is served as an MCP
resource with no same-origin server, so external asset URLs do not resolve.

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
    "dev": "cross-env NODE_ENV=development concurrently \"vite build --watch\" \"tsx --watch main.ts\"",
    "serve": "tsx main.ts"
  }
}
```

---

## 5. Server side

### 5.1 Register an App tool

```typescript
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

registerAppTool(
  server,
  "get-weather",
  {
    title: "Get Weather",
    description: "Get current weather for a location",
    inputSchema: { location: z.string() },
    _meta: { ui: { resourceUri: "ui://weather/view.html" } },
  },
  async (args) => {
    const weather = await fetchWeather(args.location);
    return {
      content: [{ type: "text", text: JSON.stringify(weather) }], // text-only fallback
      structuredContent: { weather },                             // what the view renders
    };
  },
);
```

### 5.2 Register the view resource

**Signature is positional**: `registerAppResource(server, name, uri, config, readCallback)`.

```typescript
import fs from "node:fs/promises";

registerAppResource(
  server,
  "Weather View",
  "ui://weather/view.html",
  { description: "Interactive weather display" },
  async () => ({
    contents: [
      {
        uri: "ui://weather/view.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: await fs.readFile("dist/mcp-app.html", "utf-8"),
      },
    ],
  }),
);
```

Several tools may share one `resourceUri` and one resource registration.

### 5.3 Tool visibility

`_meta.ui.visibility` controls who can call a tool:

| Value | Meaning | Use for |
|---|---|---|
| omitted | both model and view | normal App tools |
| `["app"]` | view only, hidden from the model | polling, pagination, chunk loading, UI-driven mutations |
| `["model"]` | model only, view cannot call it | tools whose side effects must go through the model |

```typescript
registerAppTool(
  server,
  "update-quantity",
  {
    description: "Update item quantity in cart",
    inputSchema: { itemId: z.string(), quantity: z.number() },
    _meta: { ui: { resourceUri: "ui://shop/cart.html", visibility: ["app"] } },
  },
  async ({ itemId, quantity }) => {
    const cart = await updateCartItem(itemId, quantity);
    return { content: [{ type: "text", text: JSON.stringify(cart) }] };
  },
);
```

Hiding a tool from the model keeps its chatter out of the context window — a
polling tool called every 2 seconds would otherwise flood it.

### 5.4 Graceful degradation

Register the App tool only when the client advertises UI support:

```typescript
import { getUiCapability, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

server.server.oninitialized = () => {
  const uiCap = getUiCapability(server.server.getClientCapabilities());

  if (uiCap?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
    registerAppTool(server, "weather",
      { description: "Weather with interactive dashboard",
        _meta: { ui: { resourceUri: "ui://weather/dashboard" } } },
      weatherHandler);
  } else {
    server.registerTool("weather", { description: "Get weather information" }, textWeatherHandler);
  }
};
```

---

## 6. View side — lifecycle

**Register every handler before `app.connect()`.** Notifications that arrive
before a handler is attached are lost. This is the single most common bug.

```typescript
import { App, PostMessageTransport } from "@modelcontextprotocol/ext-apps";

const app = new App(
  { name: "WeatherApp", version: "1.0.0" },
  {},                    // capabilities
  { autoResize: true },  // options
);

app.ontoolinput = (params) => {
  // params.arguments — final, complete tool arguments
};

app.ontoolinputpartial = (params) => {
  // healed partial JSON while the model is still generating — preview only
};

app.ontoolresult = (params) => {
  if (params.isError) { /* show error state */ }
  // params.content, params.structuredContent, params._meta
};

app.ontoolcancelled = (params) => {
  // the call was cancelled — stop spinners, reset state
};

app.onhostcontextchanged = (ctx) => { /* see §8 */ };

app.onteardown = async () => {
  // stop timers, disconnect observers, persist state
  return {};
};

await app.connect();
// or, explicitly: await app.connect(new PostMessageTransport(window.parent, window.parent));
```

After connecting, read the initial state — `onhostcontextchanged` only fires on
*changes*, so the first paint must come from `getHostContext()`:

```typescript
await app.connect();
const ctx = app.getHostContext();
if (ctx) applyHostContext(ctx);
if (ctx?.toolInfo) console.log("Rendering for tool:", ctx.toolInfo.tool.name);
```

React equivalent: `useApp({ appInfo, capabilities, onAppCreated })` — attach
handlers inside `onAppCreated`, then read `app.getHostContext()` in an effect.

---

## 7. View side — talking to the model

**This is what separates an MCP App from an embedded web page.** A view that only
renders is a picture; a view that participates in the conversation is an app.

### 7.1 Tell the model what the user is looking at

Whenever the user selects, filters, navigates or edits something in the view,
push that state into the model's context. Otherwise the user clicks a point on
your map, asks "what about this place?", and Claude has no idea what "this" is.

```typescript
const markdown = `---
item-count: ${itemList.length}
total-cost: ${totalCost}
currency: ${currency}
---

User is viewing their shopping cart with ${itemList.length} items selected:

${itemList.map((item) => `- ${item}`).join("\n")}`;

await app.updateModelContext({ content: [{ type: "text", text: markdown }] });
```

YAML frontmatter plus prose is the recommended shape: the frontmatter is trivially
parseable, the prose gives the model something to reason about. Keep it small and
call it on meaningful state changes — not on every mousemove.

### 7.2 Trigger a turn from the view

`sendMessage` injects a user turn. Combine it with `updateModelContext` when the
payload is large: park the data in context first, then send a short prompt.

```typescript
await app.updateModelContext({ content: [{ type: "text", text: longTranscript }] });
await app.sendMessage({
  role: "user",
  content: [{ type: "text", text: "Summarize the key points" }],
});

// Simple case — a button that asks about a row
const result = await app.sendMessage({
  role: "user",
  content: [{ type: "text", text: "Show me details for item #42" }],
});
if (result.isError) { /* host rejected it — don't assume it went through */ }
```

### 7.3 Report runtime failures to the model

A view stuck in a degraded state that the model doesn't know about produces
confidently wrong answers. Tell it:

```typescript
try {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  // …
} catch {
  await app.updateModelContext({
    content: [{ type: "text", text: "Error: transcription unavailable" }],
  });
}
```

Server-side failures use the normal path: return `{ isError: true, content: [...] }`
from the tool handler.

### 7.4 Call server tools

```typescript
const result = await app.callServerTool({
  name: "get_weather",
  arguments: { location: "Tokyo" },
});
if (result.isError) { /* … */ }
```

### 7.5 Read and list server resources

```typescript
const result = await app.readServerResource({ uri: "videos://bunny-1mb" });
const content = result.contents[0];
if (content && "blob" in content) {
  const binary = Uint8Array.from(atob(content.blob), (c) => c.charCodeAt(0));
  videoEl.src = URL.createObjectURL(new Blob([binary], { type: content.mimeType }));
}

const { resources } = await app.listServerResources();
```

### 7.6 Run the model from inside the view

The view can request its own completions through the host — useful for
summarising, classifying or labelling without a round trip through the chat.

```typescript
const result = await app.createSamplingMessage({
  messages: [{ role: "user", content: { type: "text", text: "Summarize this in one line." } }],
  maxTokens: 100,
});

// Agentic loop, only if the host supports it
if (app.getHostCapabilities()?.sampling?.tools) {
  const r = await app.createSamplingMessage({ messages, maxTokens: 1024, tools: [...] });
  if (r.stopReason === "toolUse") { /* … */ }
}
```

Always gate on `getHostCapabilities()` — sampling is optional for hosts.

### 7.7 Open external links

Never use `window.open` from a sandboxed view. Ask the host:

```typescript
const { isError } = await app.openLink({ url: "https://docs.example.com" });
if (isError) { /* denied — show the URL for manual copy */ }
```

### 7.8 Debug logging

The iframe console is often not inspectable. Send logs to the host instead:

```typescript
app.sendLog({ level: "info", data: "Weather data refreshed", logger: "WeatherApp" });
app.sendLog({ level: "error", data: { error: err.message } });
```

---

## 8. Host context — theme, fonts, safe areas, display mode

Never hardcode colors or fonts. Read them from the host so the view matches the
surrounding chat in both themes.

```typescript
import { applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps";

function applyHostContext(ctx) {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    mainEl.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

app.onhostcontextchanged = applyHostContext;
app.connect().then(() => {
  const ctx = app.getHostContext();
  if (ctx) applyHostContext(ctx);
});
```

```css
.container {
  background: var(--color-background-secondary);
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-primary);
  font-family: var(--font-sans, system-ui, sans-serif);
  border-radius: var(--border-radius-md);
}
```

Always give CSS variables a fallback — a host may not supply every one. Variable
groups: `--color-background-*`, `--color-text-*`, `--color-border-*`,
`--font-sans`, `--font-mono`, `--font-text-*-size`, `--font-heading-*-size`,
`--border-radius-*`. Full list: `McpUiStyleVariableKey` in `src/spec.types.ts`.

### Fullscreen

```typescript
const ctx = app.getHostContext();
const newMode = ctx?.displayMode === "inline" ? "fullscreen" : "inline";
if (ctx?.availableDisplayModes?.includes(newMode)) {
  const result = await app.requestDisplayMode({ mode: newMode });
  container.classList.toggle("fullscreen", result.mode === "fullscreen");
}
```

```css
#main { border-radius: var(--border-radius-lg); }
#main.fullscreen { border-radius: 0; }
```

### Sizing

`new App(info, caps, { autoResize: true })` handles it. For manual control use
`{ autoResize: false }`, then `app.sendSizeChanged({ width, height })` or
`app.setupSizeChangedNotifications()` (returns a cleanup function).

---

## 9. CSP and CORS

MCP App HTML runs in a sandboxed iframe with **no same-origin server**. Every
network request must be declared — including to `localhost` during development.

**`_meta.ui.csp` goes in the `contents[]` objects returned by the read callback,
not in `registerAppResource`'s config object.** Put it in the wrong place and
nothing errors — the app just silently fails to reach the network.

```typescript
registerAppResource(
  server,
  "Music Player",
  "ui://music/player.html",
  { description: "Audio player with external soundfonts" },
  async () => ({
    contents: [
      {
        uri: "ui://music/player.html",
        mimeType: RESOURCE_MIME_TYPE,
        text: musicPlayerHtml,
        _meta: {
          ui: {
            csp: {
              resourceDomains: ["https://cdn.example.com"],  // scripts, styles, images, fonts
              connectDomains: ["https://api.example.com"],   // fetch, XHR, WebSocket
            },
          },
        },
      },
    ],
  }),
);
```

**CSP controls what the browser allows. CORS controls what the API server
allows** — they are different problems. Public APIs sending
`Access-Control-Allow-Origin: *`, or APIs authenticated by key, need nothing
extra. APIs that allowlist origins need a stable origin for the view, supplied
via `_meta.ui.domain` in the same `contents[]` object:

```typescript
function computeAppDomainForClaude(mcpServerUrl: string): string {
  const hash = crypto.createHash("sha256").update(mcpServerUrl).digest("hex").slice(0, 32);
  return `${hash}.claudemcpcontent.com`;
}
// _meta: { ui: { csp: { connectDomains: [...] }, domain: APP_DOMAIN } }
```

The domain format is host-specific — check the host's documentation.

Two more keys live alongside `csp` and `domain` in the same `_meta.ui` object:

- `permissions` — request `camera`, `microphone`, `geolocation` or `clipboard`.
  Ask for these only when the user reaches for the feature that needs them; a view
  that demands the microphone on mount gets denied.
- `prefersBorder` — hint that the host should draw a visual boundary around the
  view.

`csp` also accepts `baseUriDomains` for the `base-uri` directive.

---

## 10. Production patterns

### 10.1 Polling live data

Use an app-only tool and stop it on teardown.

```typescript
let intervalId: number | null = null;

async function poll() {
  const result = await app.callServerTool({ name: "poll-data", arguments: {} });
  updateUI(result.structuredContent);
}

function startPolling() {
  if (intervalId !== null) return;
  poll();
  intervalId = window.setInterval(poll, 2000);
}

app.onteardown = async () => {
  if (intervalId !== null) clearInterval(intervalId);
  return {};
};
```

### 10.2 Pause when offscreen

WebGL, animations and polling keep burning CPU while scrolled out of view — in
the user's chat window, all day.

```typescript
const observer = new IntersectionObserver((entries) => {
  entries.forEach((e) => (e.isIntersecting ? animation.play() : animation.pause()));
});
observer.observe(container);

app.onteardown = async () => {
  observer.disconnect();
  animation.pause();
  return {};
};
```

### 10.3 Chunked loading for large payloads

Hosts cap tool response size. Stream large files through an app-only tool so the
bytes never enter model context.

Server:

```typescript
const DataChunkSchema = z.object({
  bytes: z.string(), offset: z.number(), byteCount: z.number(),
  totalBytes: z.number(), hasMore: z.boolean(),
});
const MAX_CHUNK_BYTES = 500 * 1024;

registerAppTool(server, "read_data_bytes", {
  description: "Load binary data in chunks",
  inputSchema: {
    id: z.string(),
    offset: z.number().min(0).default(0),
    byteCount: z.number().default(MAX_CHUNK_BYTES),
  },
  outputSchema: DataChunkSchema,
  _meta: { ui: { visibility: ["app"] } },
}, async ({ id, offset, byteCount }) => {
  const data = await loadData(id);
  const chunk = data.slice(offset, offset + byteCount);
  return {
    content: [{ type: "text", text: `${chunk.length} bytes at ${offset}` }],
    structuredContent: {
      bytes: Buffer.from(chunk).toString("base64"),
      offset, byteCount: chunk.length, totalBytes: data.length,
      hasMore: offset + chunk.length < data.length,
    },
  };
});
```

View: loop `callServerTool` while `hasMore`, base64-decode each chunk, report
progress, concatenate.

### 10.4 Persisting view state

The server mints a `viewUUID` in the tool result's `_meta`; the view uses it as a
`localStorage` key.

```typescript
// server, inside the tool handler
return {
  content: [{ type: "text", text: `Displaying PDF viewer for "${title}"` }],
  structuredContent: { url, title, pageCount, initialPage: 1 },
  _meta: { viewUUID: randomUUID() },
};
```

```typescript
// view
let viewUUID: string | undefined;

app.ontoolresult = (result) => {
  viewUUID = result._meta?.viewUUID ? String(result._meta.viewUUID) : undefined;
  const saved = viewUUID ? localStorage.getItem(viewUUID) : null;
  if (saved) restore(JSON.parse(saved));
};

function saveState(state: unknown) {
  if (viewUUID) localStorage.setItem(viewUUID, JSON.stringify(state));
}
```

Use `localStorage` for ephemeral view state (scroll position, camera, current
page). State that represents **user effort** — annotations, bookmarks, configs —
belongs server-side via an app-only tool, scoped by the same `viewUUID`.

### 10.5 Lower perceived latency

```typescript
app.ontoolinputpartial = (params) => {
  codePreview.textContent = (params.arguments?.code as string) ?? "";
  codePreview.style.display = "block";
};
app.ontoolinput = (params) => {
  codePreview.style.display = "none";
  render(params.arguments?.code as string);
};
```

Partial arguments are *healed* JSON — the host closes open brackets to keep it
parseable, so trailing items may be truncated. Preview only, never for anything
with side effects.

---

## 11. Testing

### Reference host (protocol-level)

```bash
npm run build && npm run serve   # terminal 1

git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host && npm install
SERVERS='["http://localhost:3001/mcp"]' npm start   # terminal 2 → http://localhost:8080
```

`basic-host` is a minimal reference, not a model of real host behaviour.

### Claude Desktop (real host)

Settings → Developer → Edit Config, then add the server to
`claude_desktop_config.json` and restart:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@scope/my-server", "--stdio"]
    }
  }
}
```

Local build during development:

```json
{
  "mcpServers": {
    "my-server": {
      "command": "bash",
      "args": ["-c", "cd /path/to/server && npm run build >&2 && node dist/index.js --stdio"]
    }
  }
}
```

Remote servers can be tested locally through `mcp-remote`. Claude asks permission
the first time a view renders — choose "Always allow".

### Checklist

1. Plain tools still return usable text
2. App tools render; `ontoolinput` and `ontoolresult` both fire
3. Theme, fonts and colors follow the host; toggle dark/light while open
4. The text `content` fallback alone would answer the user's question
5. `updateModelContext` fires on meaningful interaction — ask Claude about
   something you selected in the view and check it knows
6. Nothing keeps running after `onteardown`
7. External requests work with CSP declared, and fail *loudly* if not
8. Errors reach the model, not just the console

---

## 12. Reference

Clone the SDK pinned to the installed version and read the sources:

```bash
git clone --branch "v$(npm view @modelcontextprotocol/ext-apps version)" --depth 1 \
  https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
```

| File | Contents |
|---|---|
| `src/app.examples.ts` | Type-checked examples for every `App` method — the authority on signatures |
| `src/server/index.examples.ts` | Type-checked examples for `registerAppTool` / `registerAppResource` |
| `src/app.ts` | `App` class, handlers, lifecycle |
| `src/server/index.ts` | Server registration helpers |
| `src/spec.types.ts` | `McpUiHostContext`, `McpUiStyleVariableKey`, `McpUiResourceCsp`, display modes |
| `src/styles.ts` | `applyDocumentTheme`, `applyHostStyleVariables`, `applyHostFonts` |
| `src/react/useApp.tsx` | React hook |
| `docs/patterns.md`, `docs/csp-cors.md` | Pattern recipes and security guide |

Examples worth reading before building: `map-server` (model context + state),
`transcript-server` (context offloading + `sendMessage`), `pdf-server` (chunking
+ app-only tools), `system-monitor-server` (polling), `shadertoy-server`
(streaming input + fullscreen + visibility pause).

- Spec: `https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx`
- Quickstart: `https://apps.extensions.modelcontextprotocol.io/api/documents/Quickstart.html`
- API docs: `https://apps.extensions.modelcontextprotocol.io/api/`
- Claude host docs: `https://claude.com/docs/connectors/building/mcp-apps/getting-started`

---

## 13. Common mistakes

1. **Dropping the text `content` fallback** — breaks every non-UI host
2. **Registering handlers after `app.connect()`** — early notifications are lost
3. **Forgetting the initial `getHostContext()`** — `onhostcontextchanged` only
   fires on changes, so the first paint is unstyled
4. **`_meta.ui.csp` in the config object** instead of in `contents[]` — silent
   network failure
5. **Any network request without a CSP entry**, `localhost` included
6. **Omitting `vite-plugin-singlefile`** — assets 404 inside the sandbox
7. **A `resourceUri` with no matching `registerAppResource`**
8. **Hardcoded colors/fonts**, or host variables without a fallback value
9. **Ignoring `ctx.safeAreaInsets`** — content clipped on mobile hosts
10. **Never calling `updateModelContext`** — the model stays blind to everything
    the user does in the view; the app feels disconnected from the conversation
11. **Putting model-facing information only in the view** — it can't see the DOM
12. **No cleanup in `onteardown`** — timers and WebGL keep running
13. **`window.open` instead of `app.openLink`**
14. **Assuming optional host capabilities** — gate on `getHostCapabilities()`

---

## 14. Evaluations

Evaluation questions stay **text-based**: they measure what the model can
accomplish through tool output, not what a human sees. If a question can only be
answered by looking at the view, the tool is leaking information into the UI that
belongs in `content` or `structuredContent` — fix the tool, not the question.

Verify views manually with the checklist in §11.
