import { describe, expect, it, vi } from "vitest";

const startServerMock = vi.fn(async () => ({
  host: "127.0.0.1",
  port: 4321,
  close: async () => undefined
}));

vi.mock("../src/serverApp.js", () => ({
  startServer: startServerMock
}));

describe("runCli", () => {
  it("starts server with signal handlers enabled", async () => {
    const { runCli } = await import("../src/index.js");
    await runCli();
    expect(startServerMock).toHaveBeenCalledWith({ registerSignalHandlers: true });
  });
});
