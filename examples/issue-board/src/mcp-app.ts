import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
} from "@modelcontextprotocol/ext-apps";
import "./style.css";

interface Issue {
  id: number;
  title: string;
  priority: "P0" | "P1" | "P2";
  status: string;
  assignee: string | null;
  ageDays: number;
}

let issues: Issue[] = [];
let filter: "all" | "P0" | "P1" | "P2" = "all";
let viewUUID: string | undefined;

const root = document.getElementById("root")!;

// ---------------------------------------------------------------------------
// 1. Create the app and register EVERY handler before connect().
//    Notifications that arrive before a handler exists are lost.
// ---------------------------------------------------------------------------
const app = new App(
  { name: "IssueBoard", version: "1.0.0" },
  {},
  { autoResize: true },
);

app.ontoolinput = () => {
  render(); // shows the skeleton while the result is still in flight
};

app.ontoolresult = (result) => {
  if (result.isError) {
    root.innerHTML = `<p class="empty">Could not load issues.</p>`;
    return;
  }
  const data = result.structuredContent as { issues?: Issue[] } | undefined;
  issues = data?.issues ?? [];

  // The server mints a viewUUID per call; use it as the localStorage key so
  // state survives a re-mount without leaking between view instances.
  viewUUID = result._meta?.viewUUID ? String(result._meta.viewUUID) : undefined;
  const saved = viewUUID ? localStorage.getItem(viewUUID) : null;
  if (saved) {
    try {
      filter = JSON.parse(saved).filter ?? "all";
    } catch {
      /* corrupt state is not worth crashing over */
    }
  }
  render();
  reportToModel();
};

app.onhostcontextchanged = applyHostContext;

app.onteardown = async () => {
  // Nothing long-running here, but this is where timers, IntersectionObservers
  // and WebGL contexts must be released.
  return {};
};

await app.connect();

// onhostcontextchanged only fires on CHANGES, so the first paint has to read
// the context explicitly. Skipping this is why views render unstyled.
const initial = app.getHostContext();
if (initial) applyHostContext(initial);

// ---------------------------------------------------------------------------
// 2. Host integration
// ---------------------------------------------------------------------------
function applyHostContext(ctx: Record<string, any>): void {
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    document.body.style.padding = `${top}px ${right}px ${bottom}px ${left}px`;
  }
}

// ---------------------------------------------------------------------------
// 3. The conversational loop: tell the model what the user is looking at.
//    Debounced, and fired on commitments (filter applied) — never on motion.
// ---------------------------------------------------------------------------
let reportTimer: number | undefined;

function reportToModel(): void {
  window.clearTimeout(reportTimer);
  reportTimer = window.setTimeout(async () => {
    const visible = visibleIssues();
    const markdown = `---
filter: ${filter}
visible-count: ${visible.length}
visible-ids: ${visible.map((i) => i.id).join(", ")}
---

User is viewing the issue board filtered to ${
      filter === "all" ? "all priorities" : filter
    }, showing ${visible.length} of ${issues.length} issues.`;

    await app.updateModelContext({
      content: [{ type: "text", text: markdown }],
    });
  }, 400);
}

// ---------------------------------------------------------------------------
// 4. Actions
// ---------------------------------------------------------------------------
async function onClose(id: number): Promise<void> {
  const result = await app.callServerTool({
    name: "close_issue",
    arguments: { id },
  });

  if (result.isError) {
    // A silently degraded view produces confidently wrong answers upstream.
    await app.updateModelContext({
      content: [{ type: "text", text: `Error: could not close issue #${id}.` }],
    });
    return;
  }

  issues = issues.filter((i) => i.id !== id);
  render();

  // The model never saw this tool call — visibility is ["app"] — so tell it.
  await app.updateModelContext({
    content: [{ type: "text", text: `User closed issue #${id} from the board.` }],
  });
}

async function onExplain(issue: Issue): Promise<void> {
  // sendMessage consumes a conversation turn: only ever on explicit user intent.
  const result = await app.sendMessage({
    role: "user",
    content: [
      { type: "text", text: `Why is #${issue.id} (${issue.title}) still open?` },
    ],
  });
  if (result.isError) console.warn("Host rejected the message");
}

function setFilter(next: typeof filter): void {
  filter = next;
  if (viewUUID) localStorage.setItem(viewUUID, JSON.stringify({ filter }));
  render();
  reportToModel();
}

// ---------------------------------------------------------------------------
// 5. Render
// ---------------------------------------------------------------------------
function visibleIssues(): Issue[] {
  return filter === "all" ? issues : issues.filter((i) => i.priority === filter);
}

function render(): void {
  const visible = visibleIssues();
  root.innerHTML = "";

  const bar = document.createElement("div");
  bar.className = "bar";
  (["all", "P0", "P1", "P2"] as const).forEach((value) => {
    const button = document.createElement("button");
    button.textContent = value === "all" ? "All" : value;
    button.className = filter === value ? "chip active" : "chip";
    button.addEventListener("click", () => setFilter(value));
    bar.appendChild(button);
  });
  root.appendChild(bar);

  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = issues.length ? "No issues match this filter." : "Loading…";
    root.appendChild(empty);
    return;
  }

  const list = document.createElement("ul");
  list.className = "list";
  visible.forEach((issue) => {
    const item = document.createElement("li");
    item.className = "row";
    item.innerHTML = `
      <span class="pri ${issue.priority}">${issue.priority}</span>
      <span class="title">#${issue.id} ${issue.title}</span>
      <span class="meta">${issue.assignee ?? "unassigned"} · ${issue.ageDays}d</span>`;

    const explain = document.createElement("button");
    explain.className = "act";
    explain.textContent = "Explain";
    explain.addEventListener("click", () => void onExplain(issue));

    const close = document.createElement("button");
    close.className = "act";
    close.textContent = "Close";
    close.addEventListener("click", () => void onClose(issue.id));

    item.append(explain, close);
    list.appendChild(item);
  });
  root.appendChild(list);
}

render();
