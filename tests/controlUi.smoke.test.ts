import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { chromium } from "playwright";
import { buildServer } from "../src/api/server.js";
import { ProfileStore } from "../src/storage/profileStore.js";
import { InMemoryRuntime } from "../src/browser/inMemoryRuntime.js";
import { ActiveControlStore } from "../src/control/activeControlStore.js";
import type { AppConfig } from "../src/config.js";
import { createTempDir, removeDir } from "./testUtils.js";

const describeBrowser = process.env.RUN_BROWSER_TESTS === "1" ? describe : describe.skip;

describeBrowser("Control UI smoke", () => {
  let tempDir: string;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    tempDir = await createTempDir("control-ui-test-");
    const store = new ProfileStore(path.join(tempDir, "profiles"));
    await store.init();

    const config: AppConfig = {
      host: "127.0.0.1",
      port: 0,
      dataDir: tempDir,
      profilesDir: path.join(tempDir, "profiles"),
      artifactsDir: path.join(tempDir, "artifacts"),
      publicDir: path.join(process.cwd(), "public"),
      defaultHeadless: true,
      allowEvaluate: false
    };

    app = buildServer({
      config,
      store,
      runtime: new InMemoryRuntime(),
      controlStore: new ActiveControlStore()
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
    await removeDir(tempDir);
  });

  it("renders created profiles in the table", async () => {
    for (const name of ["UI Profile A", "UI Profile B"]) {
      const response = await app.inject({
        method: "POST",
        path: "/profiles",
        payload: {
          name,
          engine: "chrome",
          settings: {}
        }
      });
      expect(response.statusCode).toBe(201);
    }

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to determine Fastify listening address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`${baseUrl}/app`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => document.querySelectorAll("#profilesBody tr").length >= 2,
        undefined,
        { timeout: 10_000 }
      );
      const rowCount = await page.locator("#profilesBody tr").count();
      expect(rowCount).toBeGreaterThanOrEqual(2);
    } finally {
      await browser.close();
    }
  });
});
