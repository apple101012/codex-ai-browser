import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { buildServer } from "../src/api/server.js";
import { ProfileStore } from "../src/storage/profileStore.js";
import { PlaywrightRuntime } from "../src/browser/playwrightRuntime.js";
import { ActiveControlStore } from "../src/control/activeControlStore.js";
import type { AppConfig } from "../src/config.js";
import { createTempDir, removeDir } from "../tests/testUtils.js";

const waitForRow = async (page: import("playwright").Page, profileName: string) => {
  await page.waitForFunction(
    (name) => [...document.querySelectorAll("#profilesBody tr")].some((row) => row.textContent?.includes(name)),
    profileName,
    { timeout: 15_000 }
  );
};

const getRowProfileId = async (page: import("playwright").Page, profileName: string): Promise<string> => {
  const profileId = await page.evaluate((name) => {
    const row = [...document.querySelectorAll("#profilesBody tr")].find((entry) => entry.textContent?.includes(name));
    return row?.querySelectorAll("td")[1]?.textContent?.trim() ?? "";
  }, profileName);
  if (!profileId) {
    throw new Error(`Could not resolve profile id for ${profileName}`);
  }
  return profileId;
};

const assertRowCell = async (
  page: import("playwright").Page,
  profileName: string,
  cellIndex: number,
  expected: string
) => {
  await page.waitForFunction(
    ({ name, idx, text }) => {
      const row = [...document.querySelectorAll("#profilesBody tr")].find((entry) => entry.textContent?.includes(name));
      const cell = row?.querySelectorAll("td")[idx];
      return (cell?.textContent ?? "").trim() === text;
    },
    { name: profileName, idx: cellIndex, text: expected },
    { timeout: 15_000 }
  );
};

const clickRowAction = async (page: import("playwright").Page, profileName: string, buttonName: string) => {
  await page.locator("#profilesBody tr", { hasText: profileName }).first().getByRole("button", { name: buttonName }).click();
};

const screenshot = async (page: import("playwright").Page, dir: string, fileName: string) => {
  await page.screenshot({ path: path.join(dir, fileName), fullPage: true });
};

const run = async (): Promise<void> => {
  const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = path.join(process.cwd(), "artifacts", "ui-live-pass", startedAt);
  await mkdir(artifactRoot, { recursive: true });

  let tempDir = "";
  let app: ReturnType<typeof buildServer> | null = null;
  let runtime: PlaywrightRuntime | null = null;

  let checksPassed = 0;
  const checksTotal = 16;
  const details: string[] = [];

  try {
    tempDir = await createTempDir("ui-live-pass-");
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

    runtime = new PlaywrightRuntime({
      artifactsDir: config.artifactsDir,
      defaultHeadless: config.defaultHeadless,
      allowEvaluate: config.allowEvaluate
    });

    app = buildServer({
      config,
      store,
      runtime,
      controlStore: new ActiveControlStore()
    });
    await app.listen({ host: "127.0.0.1", port: 0 });

    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve listening address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("dialog", async (dialog) => {
        await dialog.accept();
      });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      if (new URL(page.url()).pathname === "/app") {
        checksPassed += 1;
        details.push("Root URL redirects to /app.");
      }
      await screenshot(page, artifactRoot, "01-loaded.png");

      await page.click("#refreshBtn");
      await page.waitForFunction(
        () => (document.querySelector("#profileActionStatus")?.textContent ?? "").toLowerCase().includes("complete"),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Refresh button responds on live UI.");
      await screenshot(page, artifactRoot, "02-refreshed.png");

      const profileName = "Live Browser Profile A";
      await page.check("#profileHeadless");
      await page.fill("#profileName", profileName);
      await page.selectOption("#profileEngine", "chromium");
      await page.click("#createProfileBtn");
      await waitForRow(page, profileName);
      checksPassed += 1;
      details.push("Created hidden profile in UI with chromium engine.");
      await screenshot(page, artifactRoot, "03-created.png");

      await assertRowCell(page, profileName, 4, "Hidden");
      checksPassed += 1;
      details.push("New profile initially shows Hidden mode.");
      await screenshot(page, artifactRoot, "04-hidden-mode.png");

      const deleteProfileName = "Live Delete Profile";
      await page.fill("#profileName", deleteProfileName);
      await page.click("#createProfileBtn");
      await waitForRow(page, deleteProfileName);
      await clickRowAction(page, deleteProfileName, "Delete");
      await page.waitForFunction(
        (name) => ![...document.querySelectorAll("#profilesBody tr")].some((row) => row.textContent?.includes(name)),
        deleteProfileName,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Delete profile action removes profile row.");
      await screenshot(page, artifactRoot, "05-delete-profile.png");

      await clickRowAction(page, profileName, "Start");
      await assertRowCell(page, profileName, 3, "Yes");
      checksPassed += 1;
      details.push("Start button launched a real runtime session in hidden mode.");
      await screenshot(page, artifactRoot, "06-started-hidden.png");

      await clickRowAction(page, profileName, "Show Browser");
      await assertRowCell(page, profileName, 4, "Visible");
      checksPassed += 1;
      details.push("Show Browser switched mode to Visible.");
      await screenshot(page, artifactRoot, "07-shown.png");

      const profileId = await getRowProfileId(page, profileName);
      await clickRowAction(page, profileName, "Set Active");
      await page.waitForFunction(
        (id) => (document.querySelector("#activeState")?.textContent ?? "").includes(id),
        profileId,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Set Active updated takeover state to selected profile.");
      await screenshot(page, artifactRoot, "08-set-active.png");

      await page.fill("#targetUrl", "https://example.com/");
      await clickRowAction(page, profileName, "Open URL");
      await page.waitForFunction(
        () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"navigate\""),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Open URL command succeeded for real runtime session.");
      await screenshot(page, artifactRoot, "09-open-url.png");

      await page.click("#listTabsBtn");
      await page.waitForFunction(
        () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"listTabs\""),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("List Tabs returned tab metadata.");
      await screenshot(page, artifactRoot, "10-list-tabs.png");

      await page.fill("#tabIndexInput", "0");
      await page.click("#setTabBtn");
      await page.waitForFunction(
        () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"selectTab\""),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Set Active Tab command works for tab 0.");

      await page.click("#readTabBtn");
      await page.waitForFunction(
        () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"getTabText\""),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Read Tab Text command works for tab 0.");
      await screenshot(page, artifactRoot, "11-tab-controls.png");

      await clickRowAction(page, profileName, "Hide Browser");
      await assertRowCell(page, profileName, 4, "Hidden");
      await assertRowCell(page, profileName, 3, "Yes");
      checksPassed += 1;
      details.push("Hide Browser switched mode back to Hidden and kept session running.");
      await screenshot(page, artifactRoot, "12-hidden-again.png");

      await clickRowAction(page, profileName, "Stop");
      await assertRowCell(page, profileName, 3, "No");
      checksPassed += 1;
      details.push("Stop button closed runtime session.");
      await screenshot(page, artifactRoot, "13-stopped.png");

      await page.click("#releaseBtn");
      await page.waitForFunction(
        () => (document.querySelector("#activeState")?.textContent ?? "").includes("none"),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Release Active cleared takeover state.");
      await screenshot(page, artifactRoot, "14-released.png");

      await page.click("#stopAllBtn");
      await page.waitForFunction(
        () => (document.querySelector("#profileActionStatus")?.textContent ?? "").toLowerCase().includes("complete"),
        undefined,
        { timeout: 15_000 }
      );
      checksPassed += 1;
      details.push("Stop All endpoint executed from UI.");
      await screenshot(page, artifactRoot, "15-stop-all.png");
    } finally {
      await browser.close();
    }
  } finally {
    if (runtime) {
      await runtime.stopAll();
    }
    if (app) {
      await app.close();
    }
    if (tempDir) {
      await removeDir(tempDir);
    }
  }

  const score = Math.round((checksPassed / checksTotal) * 100);
  const report = {
    mode: "live-runtime-ui-pass",
    overall: score,
    passedThreshold: score >= 90,
    checksPassed,
    checksTotal,
    details
  };

  const reportPath = path.join(artifactRoot, "report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(JSON.stringify({ artifactRoot, reportPath, ...report }, null, 2));

  if (score < 90) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
