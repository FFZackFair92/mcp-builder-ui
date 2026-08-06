import express from "express";
import cors from "cors";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerIssueBoard } from "./server.js";

function build(): McpServer {
  const server = new McpServer({ name: "issue-board", version: "1.0.0" });
  registerIssueBoard(server);
  return server;
}

if (process.argv.includes("--stdio")) {
  const server = build();
  await server.connect(new StdioServerTransport());
} else {
  const port = Number(process.env.PORT ?? 3001);
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    // Stateless: a fresh server and transport per request. Simpler to scale
    // than session-based streaming, and enough for an example.
    const server = build();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.listen(port, () => {
    console.log(`issue-board listening on http://localhost:${port}/mcp`);
  });
}
