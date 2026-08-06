---
name: mcp-builder-ui
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools, optionally with interactive in-chat UIs (MCP Apps, SEP-1865). Use when building MCP servers to integrate external APIs or services in Python (FastMCP) or Node/TypeScript (MCP SDK), when adding interactive UI views that render inline in the conversation, or when migrating an existing server or OpenAI App to MCP Apps.
license: Apache-2.0. See LICENSE and NOTICE at the repository root.
---

# MCP Server Development Guide (with Interactive UIs)

## Overview

Create MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. The quality of an MCP server is measured by how well it enables LLMs to accomplish real-world tasks.

Servers can optionally ship **interactive user interfaces** that render inline in the chat, via the MCP Apps extension (SEP-1865, stable `2026-01-26`). See Phase 3.

---

# Process

## 🚀 High-Level Workflow

Creating a high-quality MCP server involves five main phases:

### Phase 1: Deep Research and Planning

#### 1.1 Understand Modern MCP Design

**API Coverage vs. Workflow Tools:**
Balance comprehensive API endpoint coverage with specialized workflow tools. Workflow tools can be more convenient for specific tasks, while comprehensive coverage gives agents flexibility to compose operations. Performance varies by client—some clients benefit from code execution that combines basic tools, while others work better with higher-level workflows. When uncertain, prioritize comprehensive API coverage.

**Tool Naming and Discoverability:**
Clear, descriptive tool names help agents find the right tools quickly. Use consistent prefixes (e.g., `github_create_issue`, `github_list_repos`) and action-oriented naming.

**Context Management:**
Agents benefit from concise tool descriptions and the ability to filter/paginate results. Design tools that return focused, relevant data. Some clients support code execution which can help agents filter and process data efficiently.

**Actionable Error Messages:**
Error messages should guide agents toward solutions with specific suggestions and next steps.

**Text vs. Interactive Output:**
Most tools should return text and structured data. A subset — charts, maps, dashboards, media viewers, forms — benefit from an interactive view rendered inline in the conversation. Note candidates now; implement them in Phase 3.

#### 1.2 Study MCP Protocol Documentation

**Navigate the MCP specification:**

Start with the sitemap to find relevant pages: `https://modelcontextprotocol.io/sitemap.xml`

Then fetch specific pages with `.md` suffix for markdown format (e.g., `https://modelcontextprotocol.io/specification/draft.md`).

Key pages to review:
- Specification overview and architecture
- Transport mechanisms (streamable HTTP, stdio)
- Tool, resource, and prompt definitions
- Extensions framework (MCP Apps ships as an official extension)

#### 1.3 Study Framework Documentation

**Recommended stack:**
- **Language**: TypeScript (high-quality SDK support and good compatibility in many execution environments e.g. MCPB. Plus AI models are good at generating TypeScript code, benefiting from its broad usage, static typing and good linting tools)
- **Transport**: Streamable HTTP for remote servers, using stateless JSON (simpler to scale and maintain, as opposed to stateful sessions and streaming responses). stdio for local servers.

**Load framework documentation:**

- **MCP Best Practices**: [📋 View Best Practices](./reference/mcp_best_practices.md) - Core guidelines

**For TypeScript (recommended):**
- **TypeScript SDK**: Use WebFetch to load `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- [⚡ TypeScript Guide](./reference/node_mcp_server.md) - TypeScript patterns and examples

**For Python:**
- **Python SDK**: Use WebFetch to load `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- [🐍 Python Guide](./reference/python_mcp_server.md) - Python patterns and examples

**If the server will have interactive UIs:**
- [🎨 MCP Apps UI Guide](./reference/mcp_apps_ui.md) - `ui://` resources, App SDK, host styling

#### 1.4 Plan Your Implementation

**Understand the API:**
Review the service's API documentation to identify key endpoints, authentication requirements, and data models. Use web search and WebFetch as needed.

**Tool Selection:**
Prioritize comprehensive API coverage. List endpoints to implement, starting with the most common operations. Flag which of them are UI candidates.

---

### Phase 2: Implementation

#### 2.1 Set Up Project Structure

See language-specific guides for project setup:
- [⚡ TypeScript Guide](./reference/node_mcp_server.md) - Project structure, package.json, tsconfig.json
- [🐍 Python Guide](./reference/python_mcp_server.md) - Module organization, dependencies

#### 2.2 Implement Core Infrastructure

Create shared utilities:
- API client with authentication
- Error handling helpers
- Response formatting (JSON/Markdown)
- Pagination support

#### 2.3 Implement Tools

For each tool:

**Input Schema:**
- Use Zod (TypeScript) or Pydantic (Python)
- Include constraints and clear descriptions
- Add examples in field descriptions

**Output Schema:**
- Define `outputSchema` where possible for structured data
- Use `structuredContent` in tool responses (TypeScript SDK feature)
- Helps clients understand and process tool outputs
- Also what an MCP App view consumes, if you add one in Phase 3

**Tool Description:**
- Concise summary of functionality
- Parameter descriptions
- Return type schema

**Implementation:**
- Async/await for I/O operations
- Proper error handling with actionable messages
- Support pagination where applicable
- Return both text content and structured data when using modern SDKs

**Annotations:**
- `readOnlyHint`: true/false
- `destructiveHint`: true/false
- `idempotentHint`: true/false
- `openWorldHint`: true/false

---

### Phase 3: Interactive UI with MCP Apps (Optional)

Skip this phase if every tool is well served by text. Otherwise add interactive
views that render inline in the conversation.

**Load [🎨 MCP Apps UI Guide](./reference/mcp_apps_ui.md) for the complete guide.**

#### 3.1 Decide Which Tools Get a UI

Enhance a tool with a view when its output is structured data worth exploring,
metrics worth charting, or rich media worth rendering. Leave simple lookups and
confirmations as plain text. Present the shortlist to the user before building.

#### 3.2 Core Model

- The view is an HTML resource published under the `ui://` scheme with MIME type
  `text/html;profile=mcp-app`
- The tool links to it via `_meta.ui.resourceUri`
- The host renders it in a sandboxed iframe and exchanges JSON-RPC messages with it
- The view can call server tools back through the host

#### 3.3 Non-Negotiable Rules

1. **UI is additive.** Always keep the text `content` array — text-only hosts must
   still get a usable answer. Never move information the model needs into the view.
2. **Bundle to a single HTML file** (`vite-plugin-singlefile`); external asset URLs
   do not resolve inside the sandbox.
3. **Register all view handlers before `app.connect()`.**
4. **Style from host CSS variables** (`--color-*`, `--font-*`, `--border-radius-*`)
   so the view matches the surrounding chat in both themes.
5. **Declare external domains** (`connectDomains`, `resourceDomains`,
   `frameDomains`) or the CSP blocks them.
6. **Degrade gracefully** — use `getUiCapability()` to register plain tools for
   clients without UI support.

#### 3.4 Implementation Sketch (TypeScript)

```typescript
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";

const resourceUri = "ui://my-tool/mcp-app.html";

registerAppTool(server, "my-tool", {
  description: "Shows data with an interactive UI",
  inputSchema: { param: z.string() },
  _meta: { ui: { resourceUri } },
}, async (args) => {
  const data = await fetchData(args.param);
  return {
    content: [{ type: "text", text: JSON.stringify(data) }], // fallback
    structuredContent: { data },                             // for the view
  };
});

registerAppResource(server,
  { uri: resourceUri, name: "My Tool UI", mimeType: RESOURCE_MIME_TYPE },
  async () => ({ contents: [{ uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] }),
);
```

#### 3.5 App-Only Tools

Tools the view needs but the model shouldn't call (polling, pagination, chunk
loading) get `_meta.ui.visibility: ["app"]`.

---

### Phase 4: Review and Test

#### 4.1 Code Quality

Review for:
- No duplicated code (DRY principle)
- Consistent error handling
- Full type coverage
- Clear tool descriptions

#### 4.2 Build and Test

**TypeScript:**
- Run `npm run build` to verify compilation
- Test with MCP Inspector: `npx @modelcontextprotocol/inspector`

**Python:**
- Verify syntax: `python -m py_compile your_server.py`
- Test with MCP Inspector

**If the server has MCP Apps views:**
- Run the reference host from the SDK repo (`examples/basic-host`) and confirm each
  view renders, receives `ontoolinput`/`ontoolresult`, and follows the host theme
- Confirm every App tool still produces a sensible text-only response

See language-specific guides for detailed testing approaches and quality checklists.

---

### Phase 5: Create Evaluations

After implementing your MCP server, create comprehensive evaluations to test its effectiveness.

**Load [✅ Evaluation Guide](./reference/evaluation.md) for complete evaluation guidelines.**

#### 5.1 Understand Evaluation Purpose

Use evaluations to test whether LLMs can effectively use your MCP server to answer realistic, complex questions.

Evaluations stay **text-based** even when the server ships UIs — they measure what
the model can accomplish through tool output, not what a human sees in the view.
Verify views manually (Phase 4.2).

#### 5.2 Create 10 Evaluation Questions

To create effective evaluations, follow the process outlined in the evaluation guide:

1. **Tool Inspection**: List available tools and understand their capabilities
2. **Content Exploration**: Use READ-ONLY operations to explore available data
3. **Question Generation**: Create 10 complex, realistic questions
4. **Answer Verification**: Solve each question yourself to verify answers

#### 5.3 Evaluation Requirements

Ensure each question is:
- **Independent**: Not dependent on other questions
- **Read-only**: Only non-destructive operations required
- **Complex**: Requiring multiple tool calls and deep exploration
- **Realistic**: Based on real use cases humans would care about
- **Verifiable**: Single, clear answer that can be verified by string comparison
- **Stable**: Answer won't change over time

#### 5.4 Output Format

Create an XML file with this structure:

```xml
<evaluation>
  <qa_pair>
    <question>Find discussions about AI model launches with animal codenames. One model needed a specific safety designation that uses the format ASL-X. What number X was being determined for the model named after a spotted wild cat?</question>
    <answer>3</answer>
  </qa_pair>
<!-- More qa_pairs... -->
</evaluation>
```

Run evaluations with the bundled scripts in [`scripts/`](./scripts/) — see the
evaluation guide for usage.

---

# Reference Files

## 📚 Documentation Library

Load these resources as needed during development:

### Core MCP Documentation (Load First)
- **MCP Protocol**: Start with sitemap at `https://modelcontextprotocol.io/sitemap.xml`, then fetch specific pages with `.md` suffix
- [📋 MCP Best Practices](./reference/mcp_best_practices.md) - Universal MCP guidelines including:
  - Server and tool naming conventions
  - Response format guidelines (JSON vs Markdown)
  - Pagination best practices
  - Transport selection (streamable HTTP vs stdio)
  - Security and error handling standards

### SDK Documentation (Load During Phase 1/2)
- **Python SDK**: Fetch from `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- **TypeScript SDK**: Fetch from `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`

### Language-Specific Implementation Guides (Load During Phase 2)
- [🐍 Python Implementation Guide](./reference/python_mcp_server.md) - Complete Python/FastMCP guide with:
  - Server initialization patterns
  - Pydantic model examples
  - Tool registration with `@mcp.tool`
  - Complete working examples
  - Quality checklist

- [⚡ TypeScript Implementation Guide](./reference/node_mcp_server.md) - Complete TypeScript guide with:
  - Project structure
  - Zod schema patterns
  - Tool registration with `server.registerTool`
  - Complete working examples
  - Quality checklist

### Interactive UI Guide (Load During Phase 3)
- [🎨 MCP Apps UI Guide](./reference/mcp_apps_ui.md) - Complete MCP Apps guide with:
  - When a tool deserves a UI
  - `ui://` resources and `_meta.ui.resourceUri` wiring
  - `registerAppTool` / `registerAppResource` patterns
  - Vite single-file build pipeline
  - View lifecycle (`ontoolinput`, `ontoolresult`, `onhostcontextchanged`, `onteardown`)
  - Host theming, fullscreen, safe-area insets
  - CSP domain declarations and app-only tools
  - Graceful degradation for text-only clients
  - Testing with the reference host

### Evaluation Guide (Load During Phase 5)
- [✅ Evaluation Guide](./reference/evaluation.md) - Complete evaluation creation guide with:
  - Question creation guidelines
  - Answer verification strategies
  - XML format specifications
  - Example questions and answers
  - Running an evaluation with the provided scripts
