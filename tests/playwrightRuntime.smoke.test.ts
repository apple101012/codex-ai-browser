import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PlaywrightRuntime } from "../src/browser/playwrightRuntime.js";
import type { ProfileRecord } from "../src/domain/profile.js";
import { createTempDir, removeDir } from "./testUtils.js";

const describeBrowser = process.env.RUN_BROWSER_TESTS === "1" ? describe : describe.skip;
const dirsToClean: string[] = [];

afterEach(async () => {
  while (dirsToClean.length > 0) {
    const target = dirsToClean.pop();
    if (target) {
      await removeDir(target);
    }
  }
});

describeBrowser("PlaywrightRuntime smoke", () => {
  it("can start a profile and execute basic commands", async () => {
    const root = await createTempDir("runtime-smoke-");
    dirsToClean.push(root);

    const profile: ProfileRecord = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "smoke",
      engine: "chromium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dataDir: path.join(root, "profile"),
      managedDataDir: true,
      settings: {
        headless: true
      }
    };

    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(root, "artifacts"),
      defaultHeadless: true,
      allowEvaluate: false
    });

    await runtime.start(profile);
    const navResult = await runtime.execute(profile, {
      type: "navigate",
      url: "data:text/html,<html><body><h1 id='t'>hello</h1></body></html>"
    });
    expect(navResult.ok).toBe(true);

    const textResult = await runtime.execute(profile, {
      type: "extractText",
      selector: "#t"
    });

    expect(textResult.ok).toBe(true);
    expect((textResult.data as { text: string }).text).toContain("hello");
    await runtime.stopAll();
  });
});
