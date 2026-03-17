import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";
import { access } from "node:fs/promises";
import { createTempDir, removeDir } from "./testUtils.js";

let tempDir: string;
let mockConfig: {
  host: string;
  port: number;
  dataDir: string;
  profilesDir: string;
  artifactsDir: string;
  publicDir: string;
  defaultHeadless: boolean;
  allowEvaluate: boolean;
  apiToken?: string;
};

const initMock = vi.fn(async () => undefined);
const stopAllMock = vi.fn(async () => undefined);
const appListenMock = vi.fn(async () => undefined);
const appCloseMock = vi.fn(async () => undefined);
const buildServerMock = vi.fn(() => ({
  listen: appListenMock,
  close: appCloseMock
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig)
}));

vi.mock("../src/storage/profileStore.js", () => ({
  ProfileStore: class {
    constructor(_profilesDir: string) {}
    async init(): Promise<void> {
      await initMock();
    }
  }
}));

vi.mock("../src/browser/playwrightRuntime.js", () => ({
  PlaywrightRuntime: class {
    async stopAll(): Promise<void> {
      await stopAllMock();
    }
  }
}));

vi.mock("../src/api/server.js", () => ({
  buildServer: buildServerMock
}));

describe("startServer", () => {
  beforeEach(async () => {
    tempDir = await createTempDir("server-app-test-");
    mockConfig = {
      host: "127.0.0.1",
      port: 4321,
      dataDir: tempDir,
      profilesDir: path.join(tempDir, "profiles"),
      artifactsDir: path.join(tempDir, "artifacts"),
      publicDir: path.join(process.cwd(), "public"),
      defaultHeadless: true,
      allowEvaluate: false
    };
    initMock.mockClear();
    stopAllMock.mockClear();
    appListenMock.mockClear();
    appCloseMock.mockClear();
    buildServerMock.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await removeDir(tempDir);
  });

  it("starts server with overrides and supports graceful close", async () => {
    const { startServer } = await import("../src/serverApp.js");
    const running = await startServer({
      host: "0.0.0.0",
      port: 4999,
      registerSignalHandlers: false
    });

    expect(running.host).toBe("0.0.0.0");
    expect(running.port).toBe(4999);
    expect(initMock).toHaveBeenCalledTimes(1);
    expect(buildServerMock).toHaveBeenCalledTimes(1);
    expect(appListenMock).toHaveBeenCalledWith({ host: "0.0.0.0", port: 4999 });
    await access(mockConfig.profilesDir);
    await access(mockConfig.artifactsDir);

    await running.close();
    expect(stopAllMock).toHaveBeenCalledTimes(1);
    expect(appCloseMock).toHaveBeenCalledTimes(1);
  });

  it("registers shutdown signal handlers by default", async () => {
    const onceSpy = vi.spyOn(process, "once").mockImplementation(() => process);
    const { startServer } = await import("../src/serverApp.js");
    const running = await startServer({ registerSignalHandlers: true });

    const signals = onceSpy.mock.calls.map((call) => call[0]);
    expect(signals).toContain("SIGINT");
    expect(signals).toContain("SIGTERM");

    await running.close();
  });
});
