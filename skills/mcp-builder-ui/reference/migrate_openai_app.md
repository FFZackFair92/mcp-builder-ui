# 🔄 Migrating from the OpenAI Apps SDK

Porting an app built on `window.openai` / `openai/outputTemplate` to MCP Apps.

The mechanical part is a rename table. The conceptual part is one shift:
**OpenAI pre-populates a synchronous global; MCP gives you an async instance with
handlers.** Everything awkward about the migration comes from that.

---

## 0. Before writing any code: the CSP audit

This is the step that decides whether the migration works. MCP App HTML is served
as a resource and runs in a sandboxed iframe **with no same-origin server**, so
every origin must be declared — including the one serving your own bundles, and
including `localhost` in development. Missing origins fail **silently**.

1. Build the app with its existing build command.
2. Grep the resulting HTML, CSS and JS for **every** origin — not just the ones
   you think of as "external". Every network request needs approval.
3. For each origin, trace it to its source. A constant is universal; an env var or
   conditional means you have distinct dev and prod values, and both must be
   handled by the same configuration switch that sets the runtime URL.
4. Check third-party libraries for requests you didn't write — analytics, error
   reporting, font loaders.

Write the findings down as three lists — `resourceDomains`, `connectDomains`,
`frameDomains` — marking each origin universal, dev-only or prod-only. A
hardcoded prod origin in the CSP of an app that also runs in dev is a bug you will
find at the worst moment.

---

## 1. Server side

### Metadata

| OpenAI | MCP Apps | Notes |
|---|---|---|
| `_meta["openai/outputTemplate"]` | `_meta.ui.resourceUri` | |
| `_meta["openai/widgetAccessible"]` (bool) | `_meta.ui.visibility` (array) | `true` → include `"app"` |
| `_meta["openai/visibility"]` (string) | `_meta.ui.visibility` (array) | `"public"` → include `"model"` |
| `_meta["openai/widgetCSP"]` | `_meta.ui.csp` | field names snake_case → camelCase |
| `_meta["openai/widgetDomain"]` | `_meta.ui.domain` | |
| `_meta["openai/widgetPrefersBorder"]` | `_meta.ui.prefersBorder` | |
| `_meta["openai/widgetDescription"]` | — | Use `app.updateModelContext()` instead |
| `_meta["openai/toolInvocation/invoking"]` | — | Not yet implemented |
| `_meta["openai/toolInvocation/invoked"]` | — | Not yet implemented |
| — | `_meta.ui.permissions` | **New in MCP**: camera, microphone, geolocation, clipboard |

### CSP fields

| OpenAI | MCP Apps |
|---|---|
| `resource_domains` | `resourceDomains` |
| `connect_domains` | `connectDomains` |
| `frame_domains` | `frameDomains` |
| `redirect_domains` | — (OpenAI only) |
| — | `baseUriDomains` (MCP only) |

### MIME type

`text/html+skybridge` → `text/html;profile=mcp-app`. Don't type the string —
`registerAppResource()` sets it, and `RESOURCE_MIME_TYPE` is exported if you need
it explicitly.

### Registration

Swap `server.registerTool` / `server.registerResource` for `registerAppTool` /
`registerAppResource`, which build the metadata for you.

**Before:**

```typescript
server.registerTool("shopping-cart", {
  title: "Shopping Cart",
  inputSchema: { userId: z.string() },
  _meta: {
    "openai/outputTemplate": "ui://view/cart.html",
    "openai/widgetAccessible": true,
  },
}, handler);

server.registerResource("Cart View", "ui://view/cart.html",
  { mimeType: "text/html+skybridge" },
  async () => ({ contents: [{
    uri: "ui://view/cart.html",
    mimeType: "text/html+skybridge",
    text: getCartHtml(),
    _meta: { "openai/widgetCSP": {
      resource_domains: ["https://cdn.example.com"],
      connect_domains: ["https://api.example.com"],
    }},
  }]}),
);
```

**After:**

```typescript
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE }
  from "@modelcontextprotocol/ext-apps/server";

registerAppTool(server, "shopping-cart", {
  title: "Shopping Cart",
  inputSchema: { userId: z.string() },
  annotations: { readOnlyHint: true },
  _meta: { ui: { resourceUri: "ui://view/cart.html", visibility: ["app", "model"] } },
}, handler);

registerAppResource(server, "Cart View", "ui://view/cart.html",
  { description: "Shopping cart UI" },
  async () => ({ contents: [{
    uri: "ui://view/cart.html",
    mimeType: RESOURCE_MIME_TYPE,
    text: getCartHtml(),
    _meta: { ui: { csp: {
      resourceDomains: ["https://cdn.example.com"],
      connectDomains: ["https://api.example.com"],
    }}},
  }]}),
);
```

Note `registerAppResource` is **positional**: `(server, name, uri, config, readCallback)`.

### CORS

MCP clients make cross-origin requests. With Express, `app.use(cors())` is enough.
Raw HTTP servers must additionally allow the headers `mcp-session-id`,
`mcp-protocol-version`, `last-event-id`, and expose `mcp-session-id`.

---

## 2. Client side

### The shift

```typescript
// OpenAI: everything is there when your code runs
applyTheme(window.openai.theme);
render(window.openai.toolInput);
```

```typescript
// MCP: nothing is there until you connect, and handlers must exist first
const app = new App({ name: "MyApp", version: "1.0.0" });

app.ontoolinput = (params) => render(params.arguments);
app.ontoolresult = (params) => update(params.structuredContent);
app.onhostcontextchanged = (ctx) => { if (ctx.theme) applyTheme(ctx.theme); };

await app.connect();
applyTheme(app.getHostContext()?.theme);   // initial values, after connect
```

Register **every** handler before `connect()`. Notifications can fire the instant
the connection opens, and anything that arrives before a handler exists is gone.

### Context

| OpenAI | MCP Apps |
|---|---|
| `window.openai.theme` | `app.getHostContext()?.theme` |
| `window.openai.locale` | `app.getHostContext()?.locale` |
| `window.openai.displayMode` | `app.getHostContext()?.displayMode` |
| `window.openai.maxHeight` | `app.getHostContext()?.viewport?.maxHeight` |
| `window.openai.safeArea` | `app.getHostContext()?.safeAreaInsets` |
| `window.openai.userAgent` | `app.getHostContext()?.userAgent` |
| — | `app.getHostContext()?.availableDisplayModes` |
| — | `app.getHostContext()?.toolInfo` |

### Data and calls

| OpenAI | MCP Apps |
|---|---|
| `window.openai.toolInput` | `app.ontoolinput` → `params.arguments` |
| `window.openai.toolOutput` | `app.ontoolresult` → `params.structuredContent` |
| `window.openai.toolResponseMetadata` | `app.ontoolresult` → `params._meta` |
| `window.openai.callTool(name, args)` | `app.callServerTool({ name, arguments })` |
| `window.openai.sendFollowUpMessage({ prompt })` | `app.sendMessage({ role: "user", content: [{ type: "text", text }] })` |
| `window.openai.openExternal({ href })` | `app.openLink({ url })` — note the param rename |
| `window.openai.requestDisplayMode({ mode })` | `app.requestDisplayMode({ mode })` — check `availableDisplayModes` first |
| `window.openai.notifyIntrinsicHeight(h)` | `app.sendSizeChanged({ width, height })`, or `{ autoResize: true }` |
| `addEventListener("openai:set_globals")` | `app.onhostcontextchanged` |
| `console.log` | `app.sendLog({ level, data })` |
| — | `app.ontoolinputpartial`, `app.ontoolcancelled`, `app.onteardown` |
| — | `app.getHostVersion()`, `app.getHostCapabilities()` |

React apps: `useApp()` manages the lifecycle for you.

---

## 3. What you lose, and what to do about it

| OpenAI feature | Replacement |
|---|---|
| `widgetState` / `setWidgetState()` | `localStorage` keyed by the server-minted `viewUUID`, or server-side state via an app-only tool |
| `widgetDescription` | `app.updateModelContext()` — dynamic, and strictly better |
| `toolInvocation/invoking` / `invoked` | Nothing yet. Render your own loading state from `ontoolinput` / `ontoolinputpartial` |
| `uploadFile()` / `getFileDownloadUrl()` | Nothing yet |
| `requestModal()` / `requestClose()` | Nothing yet. `requestDisplayMode({ mode: "fullscreen" })` covers some cases |
| `window.openai.view` | Nothing yet |

Two of these are upgrades in disguise. `widgetState` forced state through the
host; `viewUUID` + `localStorage` is more explicit and survives better. And
`widgetDescription` was a static string set at registration —
`updateModelContext` lets the view tell the model what the user is *currently*
doing, which is the whole point of an in-chat app.

---

## 4. Finishing checklist

Grep the codebase for leftovers. Each pattern means work remains:

| Pattern | Means |
|---|---|
| `"openai/` | Old metadata keys → `_meta.ui.*` |
| `text/html+skybridge` | Old MIME type → `RESOURCE_MIME_TYPE` |
| `_domains"` / `_domains:` | snake_case CSP → camelCase |
| `window.openai.toolInput` | → `params.arguments` in `ontoolinput` |
| `window.openai.toolOutput` | → `params.structuredContent` in `ontoolresult` |
| `window.openai` | Any remaining global usage |

Then, for **every** origin from the §0 audit, point at the line in the CSP config
where it appears. For every conditional origin, point at the single configuration
switch that sets both the runtime URL and the CSP entry.

Finally, ask the question the port itself won't: your OpenAI widget probably had
no equivalent of `updateModelContext`. Now that you do, where should the view be
telling the model what the user is doing? See
[🧭 Conversational App Design](./app_design.md) §3–4. A straight port works; using
what the port unlocks is what makes it worth doing.

---

## 5. Testing

```bash
npm run build && npm run serve

git clone --depth 1 https://github.com/modelcontextprotocol/ext-apps.git /tmp/mcp-ext-apps
cd /tmp/mcp-ext-apps/examples/basic-host && npm install
SERVERS='["http://localhost:3001/mcp"]' npm start
```

Confirm: no console errors, `ontoolinput` fires with the arguments,
`ontoolresult` fires with the result, theme follows the host, and every network
request the app makes actually completes.
