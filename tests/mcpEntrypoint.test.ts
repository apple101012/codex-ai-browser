import { describe, expect, it, vi } from "vitest";

const connectMock = vi.fn<(transport: unknown) => Promise<void>>(async () => undefined);
const registerToolsMock = vi.fn();
const apiRequestMock = vi.fn(async () => ({}));

vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: class {
    registerTool(): void {}
    async connect(transport: unknown): Promise<void> {
      await connectMock(transport);
    }
  }
}));

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {}
}));

vi.mock("../src/mcp/registerTools.js", () => ({
  registerBrowserTools: registerToolsMock
}));

vi.mock("../src/mcp/apiClient.js", () => ({
  apiRequest: apiRequestMock
}));

describe("mcp entrypoint", () => {
  it("registers tools and connects to stdio transport", async () => {
    const { runMcpServer } = await import("../src/mcp.js");
    expect(registerToolsMock).toHaveBeenCalledTimes(1);
    await runMcpServer();
    expect(connectMock).toHaveBeenCalledTimes(1);
  });
});
