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

describeBrowser("PlaywrightRuntime multi-profile", () => {
  it("runs three isolated profile sessions", async () => {
    const root = await createTempDir("runtime-multi-");
    dirsToClean.push(root);

    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(root, "artifacts"),
      defaultHeadless: true,
      allowEvaluate: false
    });

    const profiles: ProfileRecord[] = [0, 1, 2].map((idx) => ({
      id: `00000000-0000-4000-8000-00000000000${idx + 1}`,
      name: `profile-${idx + 1}`,
      engine: "chromium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      dataDir: path.join(root, `profile-${idx + 1}`),
      managedDataDir: true,
      settings: {
        headless: true
      }
    }));

    for (const profile of profiles) {
      await runtime.start(profile);
      await runtime.execute(profile, {
        type: "navigate",
        url: `data:text/html,<html><body><h1 id='u'>user-${profile.name}</h1></body></html>`
      });
    }

    const running = runtime.listRunningIds();
    expect(running).toHaveLength(3);

    for (const profile of profiles) {
      const state = await runtime.execute(profile, {
        type: "extractText",
        selector: "#u"
      });
      expect(state.ok).toBe(true);
      const text = (state.data as { text: string }).text;
      expect(text).toContain(`user-${profile.name}`);
    }

    await runtime.stopAll();
    expect(runtime.listRunningIds()).toHaveLength(0);
  });
});
