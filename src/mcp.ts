import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { pathToFileURL } from "node:url";
import { apiRequest } from "./mcp/apiClient.js";
import { registerBrowserTools } from "./mcp/registerTools.js";

const server = new McpServer({
  name: "codex-ai-browser",
  version: "0.1.0"
});

registerBrowserTools(server, apiRequest);

export const runMcpServer = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  runMcpServer().catch((error) => {
    console.error("MCP server failed:", error);
    process.exit(1);
  });
}
