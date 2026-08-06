# 🐍 MCP Apps in Python

Adding interactive views to a **Python** MCP server built on FastMCP.

---

## 1. The thing nobody tells you

**There is no Python SDK for MCP Apps.** `@modelcontextprotocol/ext-apps` is
TypeScript only. This does not block you — MCP Apps is a wire protocol, and the
split falls naturally:

| Side | Language | How |
|---|---|---|
| **Server** — tool and resource registration | Python | FastMCP's `meta=` parameter. No extra dependency. |
| **View** — the HTML that renders in chat | JavaScript | The JS SDK, loaded from a CDN or bundled |

The view runs in a browser iframe. It was always going to be JavaScript. Python
only has to attach the right metadata and serve the HTML string.

---

## 2. Server side — FastMCP

Everything is done with the `meta=` parameter on the standard decorators.

```python
from mcp.server.fastmcp import FastMCP
from mcp import types

VIEW_URI = "ui://qr-server/view.html"

mcp = FastMCP("QR Code Server", stateless_http=True, host=HOST, port=PORT)
```

### 2.1 The tool

```python
@mcp.tool(meta={
    "ui": {"resourceUri": VIEW_URI},
    "ui/resourceUri": VIEW_URI,   # legacy key, for older hosts
})
def generate_qr(text: str = "https://modelcontextprotocol.io",
                box_size: int = 10) -> list[types.ImageContent]:
    """Generate a QR code from text.

    Args:
        text: The text/URL to encode
        box_size: Size of each box in pixels (default: 10)
    """
    ...
    return [types.ImageContent(type="image", data=b64, mimeType="image/png")]
```

Notes:

- The docstring **is** the tool description, and the `Args:` block becomes the
  parameter descriptions. Write them as prompt engineering, not as comments.
- Emitting both `ui.resourceUri` and the flat `ui/resourceUri` key costs nothing
  and covers hosts that haven't moved to the nested form.
- The return value is the text-only fallback path. Keep it useful on its own —
  the same rule as TypeScript.

Tool visibility works the same way:

```python
@mcp.tool(meta={"ui": {"resourceUri": VIEW_URI, "visibility": ["app"]}})
def poll_data() -> dict:
    """Polls latest data for the view. Not exposed to the model."""
    ...
```

### 2.2 The view resource

```python
@mcp.resource(
    VIEW_URI,
    mime_type="text/html;profile=mcp-app",
    meta={"ui": {"csp": {"resourceDomains": ["https://unpkg.com"]}}},
)
def view() -> str:
    """View HTML resource with CSP metadata for external dependencies."""
    return VIEW_HTML
```

Two things that will bite you:

1. **`mime_type` must be exactly `text/html;profile=mcp-app`.** Anything else and
   the host treats it as a plain resource and never renders it.
2. **CSP lives in the decorator's `meta=` here.** This differs from the
   TypeScript SDK, where it goes in the `contents[]` objects returned by the read
   callback. FastMCP builds those objects for you, so the decorator is the right
   place. Same keys: `resourceDomains`, `connectDomains`, `frameDomains`,
   plus `domain` for CORS allowlisting.

### 2.3 Dual transport

Serve stdio for desktop clients and HTTP for the reference host from one file:

```python
if __name__ == "__main__":
    if "--stdio" in sys.argv:
        mcp.run(transport="stdio")
    else:
        app = mcp.streamable_http_app()
        app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
        )
        uvicorn.run(app, host=HOST, port=PORT)
```

CORS middleware is required for browser-based hosts to reach the HTTP endpoint at
all.

### 2.4 Dependencies with PEP 723

A single-file server that anyone can run without a virtualenv:

```python
#!/usr/bin/env uv run
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "mcp>=1.26.0",
#     "uvicorn>=0.34.0",
#     "starlette>=0.46.0",
# ]
# ///
```

Then `uv run server.py`, and in the client config:

```json
{
  "mcpServers": {
    "qr": {
      "command": "bash",
      "args": ["-c", "uv run ~/code/qr-server/server.py --stdio"]
    }
  }
}
```

---

## 3. View side — two strategies

### Strategy A — CDN, zero build

Embed the HTML as a Python string and pull the SDK from a CDN. No `npm`, no
bundler, no build step. This is how the official Python examples do it.

```python
VIEW_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta name="color-scheme" content="light dark">
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: transparent; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import { App } from "https://unpkg.com/@modelcontextprotocol/ext-apps@0.4.0/app-with-deps";

    const app = new App({ name: "QR View", version: "1.0.0" });

    app.ontoolresult = ({ content, structuredContent }) => {
      // render
    };

    function handleHostContextChanged(ctx) {
      if (ctx.safeAreaInsets) {
        const { top, right, bottom, left } = ctx.safeAreaInsets;
        document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
      }
    }
    app.onhostcontextchanged = handleHostContextChanged;

    await app.connect();
    const ctx = app.getHostContext();
    if (ctx) handleHostContextChanged(ctx);
  </script>
</body>
</html>"""
```

Requirements and trade-offs:

- The CDN host **must** appear in `resourceDomains`, or the import is blocked and
  the view stays blank with no obvious error.
- Import the `app-with-deps` bundle, not the bare module — the plain entry point
  expects a bundler to resolve its dependencies.
- **Pin the version** in the URL. An unpinned CDN import is a third party who can
  change your app.
- Cost: a network fetch on every render, and a hard dependency on a CDN being up.
  Fine for demos and internal tools; think twice for anything shipped widely.

### Strategy B — bundle a single file

Build the view with Vite and `vite-plugin-singlefile` exactly as in the
TypeScript guide, then have Python read the artifact:

```python
from pathlib import Path

VIEW_HTML = (Path(__file__).parent / "dist" / "mcp-app.html").read_text()

@mcp.resource(VIEW_URI, mime_type="text/html;profile=mcp-app")
def view() -> str:
    return VIEW_HTML
```

No CDN, no `resourceDomains` for the SDK, no runtime fetch, and you get
TypeScript and a framework in the view. Cost: a Node toolchain sits next to your
Python project.

**Rule of thumb:** Strategy A while the view is a few dozen lines and mostly
display. Strategy B as soon as it has real state, or ships to users you don't
know.

---

## 4. Everything in the view is unchanged

Once the view is running, it is a normal MCP App. The full JS API applies —
`updateModelContext`, `sendMessage`, `callServerTool`, `readServerResource`,
`createSamplingMessage`, `requestDisplayMode`, `sendLog`, host CSS variables,
`onteardown`. See [🎨 MCP Apps UI Guide](./mcp_apps_ui.md) §6–§10 and
[🧭 Conversational App Design](./app_design.md).

In particular, a Python server gets no free pass on the conversational loop: if
the view never calls `updateModelContext`, the model stays blind to what the user
did, exactly as in TypeScript.

Calling back into Python from the view is the ordinary path:

```javascript
const result = await app.callServerTool({ name: "poll_data", arguments: {} });
```

…which lands in your `@mcp.tool(meta={"ui": {"visibility": ["app"]}})` function.

---

## 5. Structured data from Python

The view usually wants `structuredContent`, not prose. Return a Pydantic model or
a `dict` and FastMCP populates it, while also generating an `outputSchema`:

```python
from pydantic import BaseModel

class Reading(BaseModel):
    timestamp: str
    cpu_percent: float
    memory_percent: float

@mcp.tool(meta={"ui": {"resourceUri": VIEW_URI}})
def get_stats() -> list[Reading]:
    """Current system statistics."""
    return [...]
```

For full control over both channels, return a `types.CallToolResult` with
`content` (the model's answer) and `structuredContent` (the view's data) set
independently. That separation is the whole design — see `app_design.md` §1.

---

## 6. Testing

```bash
uv run server.py                     # HTTP on :3001

# reference host, in another terminal
SERVERS='["http://localhost:3001/mcp"]' npm start   # in examples/basic-host
```

For Claude Desktop, use the `--stdio` config from §2.4 and restart the app.

---

## 7. Python-specific gotchas

1. **Wrong `mime_type`** — must be `text/html;profile=mcp-app` exactly; anything
   else silently never renders.
2. **CSP location differs from TypeScript** — decorator `meta=` in FastMCP,
   `contents[]` in the TS SDK. Both silently fail when misplaced.
3. **Missing CORS middleware** on the HTTP app — browser hosts can't connect.
4. **Unpinned CDN import** — the view breaks the day upstream ships a major.
5. **CDN domain not in `resourceDomains`** — blank view, no error in the host UI.
6. **Importing the non-`with-deps` bundle** from a CDN — unresolved imports.
7. **Forgetting `stateless_http=True`** when you intend to scale horizontally.
8. **Treating the docstring as documentation** — it is the model's only
   description of the tool.

---

## 8. Reference

- Python examples in the SDK repo: `examples/qr-server/` (single-file, CDN view,
  PEP 723) and `examples/say-server/`
- FastMCP: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- Everything else: [🎨 MCP Apps UI Guide](./mcp_apps_ui.md)
