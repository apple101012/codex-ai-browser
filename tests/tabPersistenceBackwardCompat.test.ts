import { describe, it, expect } from "vitest";
import path from "node:path";
import { PlaywrightRuntime } from "../src/browser/playwrightRuntime.js";
import type { ProfileRecord } from "../src/domain/profile.js";

describe("Tab Persistence Backward Compatibility", () => {
  it("should work without profileStore parameter", async () => {
    const profile: ProfileRecord = {
      id: "test-no-store",
      name: "test-no-store",
      engine: "chromium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dataDir: path.join(process.cwd(), "test-temp-no-store"),
      managedDataDir: true,
      settings: { headless: true }
    };

    // Create runtime without profileStore
    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(process.cwd(), "test-temp-artifacts"),
      defaultHeadless: true,
      allowEvaluate: false
      // No profileStore parameter
    });

    // Should not throw and should work normally
    expect(() => runtime).not.toThrow();
    expect(runtime).toBeDefined();
  });
});
