import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { closeIssue, listIssues, type Issue } from "./data.js";

const VIEW_URI = "ui://issue-board/mcp-app.html";
const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The model's answer, written for someone who cannot see the view.
 *
 * This is the single most important function in the example. If it returns
 * "Rendered 8 issues", every follow-up question in the conversation fails.
 */
function summarize(issues: Issue[]): string {
  const p0 = issues.filter((i) => i.priority === "P0");
  const stale = p0.filter((i) => i.ageDays > 14);
  const unassigned = issues.filter((i) => i.assignee === null);

  const staleText = stale.length
    ? `, of which ${stale.length} have been open more than 14 days (${stale
        .map((i) => `#${i.id} ${i.title}`)
        .join("; ")})`
    : "";

  return [
    `${issues.length} open issues. ${p0.length} are P0${staleText}.`,
    unassigned.length
      ? `${unassigned.length} issues are unassigned (${unassigned.map((i) => `#${i.id}`).join(", ")}).`
      : "All issues are assigned.",
  ].join(" ");
}

export function registerIssueBoard(server: McpServer): void {
  // ---- The App tool -------------------------------------------------------
  registerAppTool(
    server,
    "list_issues",
    {
      title: "List Issues",
      description:
        "List issues from the tracker and display them in an interactive board.",
      inputSchema: {
        status: z
          .enum(["open", "closed", "all"])
          .default("open")
          .describe("Which issues to return. Defaults to open."),
      },
      _meta: { ui: { resourceUri: VIEW_URI } },
    },
    async ({ status }) => {
      const issues = listIssues(status);
      return {
        // For the model: a standalone answer.
        content: [{ type: "text", text: summarize(issues) }],
        // For the view: the data it renders.
        structuredContent: { issues },
        // For the view: a stable key for localStorage across re-mounts.
        _meta: { viewUUID: randomUUID() },
      };
    },
  );

  // ---- App-only tool ------------------------------------------------------
  // visibility: ["app"] hides this from the model. The view calls it directly,
  // then reports the change back with updateModelContext, so the model still
  // learns what happened without the tool cluttering its tool list.
  registerAppTool(
    server,
    "close_issue",
    {
      title: "Close Issue",
      description: "Close an issue. Called by the issue board view.",
      inputSchema: { id: z.number().describe("Issue id, e.g. 245") },
      _meta: { ui: { resourceUri: VIEW_URI, visibility: ["app"] } },
    },
    async ({ id }) => {
      const issue = closeIssue(id);
      if (!issue) {
        return {
          isError: true,
          content: [{ type: "text", text: `No issue #${id}` }],
        };
      }
      return {
        content: [{ type: "text", text: `Closed #${issue.id}` }],
        structuredContent: { issue },
      };
    },
  );

  // ---- The view resource --------------------------------------------------
  // Signature is positional: (server, name, uri, config, readCallback).
  registerAppResource(
    server,
    "Issue Board",
    VIEW_URI,
    { description: "Interactive issue board" },
    async () => ({
      contents: [
        {
          uri: VIEW_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(path.join(here, "ui", "mcp-app.html"), "utf-8"),
          // This example makes no external requests, so no csp block is needed.
          // If it did, it would go HERE, inside contents[] — not in the config
          // object above. Misplacing it fails silently.
          //
          // _meta: { ui: { csp: { connectDomains: ["https://api.example.com"] } } },
        },
      ],
    }),
  );
}
