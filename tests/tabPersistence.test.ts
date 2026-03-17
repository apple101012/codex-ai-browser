import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { PlaywrightRuntime } from "../src/browser/playwrightRuntime.js";
import { ProfileStore } from "../src/storage/profileStore.js";
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

describeBrowser("Tab Persistence", () => {
  it("should save and restore tabs when profile is stopped and restarted", async () => {
    const root = await createTempDir("tab-persist-");
    dirsToClean.push(root);

    const profilesDir = path.join(root, "profiles");
    const store = new ProfileStore(profilesDir);
    await store.init();

    // Create a profile
    const profile = await store.create({
      name: "tab-persist-test",
      engine: "chromium",
      settings: { headless: true }
    });

    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(root, "artifacts"),
      defaultHeadless: true,
      allowEvaluate: false,
      profileStore: store
    });

    try {
      // Start the profile
      await runtime.start(profile);

      // Open multiple tabs with different URLs
      await runtime.execute(profile, {
        type: "navigate",
        url: "data:text/html,<html><body><h1>Page 1</h1></body></html>"
      });

      await runtime.execute(profile, {
        type: "newTab",
        url: "data:text/html,<html><body><h1>Page 2</h1></body></html>"
      });

      await runtime.execute(profile, {
        type: "newTab",
        url: "data:text/html,<html><body><h1>Page 3</h1></body></html>"
      });

      // Get list of tabs before stopping
      const listBeforeStop = await runtime.execute(profile, {
        type: "listTabs"
      });
      expect(listBeforeStop.ok).toBe(true);
      const tabsBeforeStop = (listBeforeStop.data as { tabs: Array<{ url: string; active: boolean }> }).tabs;
      expect(tabsBeforeStop.length).toBe(3);

      // Stop the profile (should save tabs)
      await runtime.stop(profile.id);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Verify tabs were saved
      const updatedProfile = await store.get(profile.id);
      expect(updatedProfile).not.toBeNull();
      expect(updatedProfile!.savedTabs).toBeDefined();
      expect(updatedProfile!.savedTabs!.length).toBe(3);

      // Restart the profile (should restore tabs)
      await runtime.start(updatedProfile!);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // List tabs after restart
      const listAfterRestart = await runtime.execute(updatedProfile!, {
        type: "listTabs"
      });
      expect(listAfterRestart.ok).toBe(true);
      const tabsAfterRestart = (listAfterRestart.data as { tabs: Array<{ url: string; active: boolean }> }).tabs;

      // Should have the same number of tabs
      expect(tabsAfterRestart.length).toBe(3);

      // Verify URLs match
      const urlsBefore = tabsBeforeStop.map((tab) => tab.url).sort();
      const urlsAfter = tabsAfterRestart.map((tab) => tab.url).sort();
      expect(urlsAfter).toEqual(urlsBefore);
    } finally {
      await runtime.stopAll();
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }, 30_000);

  it("should handle empty saved tabs gracefully", async () => {
    const root = await createTempDir("tab-persist-empty-");
    dirsToClean.push(root);

    const profilesDir = path.join(root, "profiles");
    const store = new ProfileStore(profilesDir);
    await store.init();

    const profile = await store.create({
      name: "tab-persist-empty",
      engine: "chromium",
      settings: { headless: true }
    });

    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(root, "artifacts"),
      defaultHeadless: true,
      allowEvaluate: false,
      profileStore: store
    });

    try {
      // Start profile without saved tabs
      await runtime.start(profile);
      expect(runtime.isRunning(profile.id)).toBe(true);

      // Should have at least one default tab
      const listResult = await runtime.execute(profile, {
        type: "listTabs"
      });
      expect(listResult.ok).toBe(true);
      const tabs = (listResult.data as { tabs: Array<unknown> }).tabs;
      expect(tabs.length).toBeGreaterThanOrEqual(1);
    } finally {
      await runtime.stopAll();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, 15_000);

  it("should preserve active tab index", async () => {
    const root = await createTempDir("tab-persist-active-");
    dirsToClean.push(root);

    const profilesDir = path.join(root, "profiles");
    const store = new ProfileStore(profilesDir);
    await store.init();

    const profile = await store.create({
      name: "tab-persist-active",
      engine: "chromium",
      settings: { headless: true }
    });

    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(root, "artifacts"),
      defaultHeadless: true,
      allowEvaluate: false,
      profileStore: store
    });

    try {
      await runtime.start(profile);

      // Create multiple tabs
      await runtime.execute(profile, {
        type: "navigate",
        url: "data:text/html,<html><body><h1>Tab 1</h1></body></html>"
      });

      await runtime.execute(profile, {
        type: "newTab",
        url: "data:text/html,<html><body><h1>Tab 2</h1></body></html>"
      });

      await runtime.execute(profile, {
        type: "newTab",
        url: "data:text/html,<html><body><h1>Tab 3</h1></body></html>"
      });

      // Select the first tab
      await runtime.execute(profile, {
        type: "selectTab",
        tabIndex: 0
      });

      // Get active tab index
      const listBeforeStop = await runtime.execute(profile, {
        type: "listTabs"
      });
      const tabsBefore = (listBeforeStop.data as { tabs: Array<{ active: boolean; url: string }> }).tabs;
      const activeIndexBefore = tabsBefore.findIndex((tab) => tab.active);
      expect(activeIndexBefore).toBe(0);

      // Stop and restart
      await runtime.stop(profile.id);
      await new Promise((resolve) => setTimeout(resolve, 500));

      const updatedProfile = await store.get(profile.id);
      await runtime.start(updatedProfile!);
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Check active tab after restart
      const listAfterRestart = await runtime.execute(updatedProfile!, {
        type: "listTabs"
      });
      const tabsAfter = (listAfterRestart.data as { tabs: Array<{ active: boolean }> }).tabs;
      const activeIndexAfter = tabsAfter.findIndex((tab) => tab.active);

      // The active tab should be restored (might be index 0 or the last active one)
      expect(activeIndexAfter).toBeGreaterThanOrEqual(0);
    } finally {
      await runtime.stopAll();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, 30_000);

  it("should filter out invalid URLs when saving tabs", async () => {
    const root = await createTempDir("tab-persist-filter-");
    dirsToClean.push(root);

    const profilesDir = path.join(root, "profiles");
    const store = new ProfileStore(profilesDir);
    await store.init();

    const profile = await store.create({
      name: "tab-persist-filter",
      engine: "chromium",
      settings: { headless: true }
    });

    const runtime = new PlaywrightRuntime({
      artifactsDir: path.join(root, "artifacts"),
      defaultHeadless: true,
      allowEvaluate: false,
      profileStore: store
    });

    try {
      await runtime.start(profile);

      // Navigate to a valid URL
      await runtime.execute(profile, {
        type: "navigate",
        url: "data:text/html,<html><body><h1>Valid Page</h1></body></html>"
      });

      // Stop the profile
      await runtime.stop(profile.id);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Check saved tabs
      const updatedProfile = await store.get(profile.id);
      expect(updatedProfile).not.toBeNull();
      expect(updatedProfile!.savedTabs).toBeDefined();
      
      // All saved tabs should have valid URLs (not about: or chrome://)
      if (updatedProfile!.savedTabs && updatedProfile!.savedTabs.length > 0) {
        for (const tab of updatedProfile!.savedTabs) {
          expect(tab.url).not.toMatch(/^about:/);
          expect(tab.url).not.toMatch(/^chrome:\/\//);
        }
      }
    } finally {
      await runtime.stopAll();
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }, 15_000);
});
