import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type Page } from "playwright";
import { buildServer } from "../src/api/server.js";
import { ProfileStore } from "../src/storage/profileStore.js";
import { InMemoryRuntime } from "../src/browser/inMemoryRuntime.js";
import { ActiveControlStore } from "../src/control/activeControlStore.js";
import type { AppConfig } from "../src/config.js";
import { createTempDir, removeDir } from "../tests/testUtils.js";

interface AgentReport {
  name: string;
  score: number;
  checksPassed: number;
  checksTotal: number;
  details: string[];
}

const waitForRow = async (page: Page, profileName: string) => {
  await page.waitForFunction(
    (name) => [...document.querySelectorAll("#profilesBody tr")].some((row) => row.textContent?.includes(name)),
    profileName,
    { timeout: 12_000 }
  );
};

const assertRowCell = async (page: Page, profileName: string, cellIndex: number, expected: string) => {
  await page.waitForFunction(
    ({ name, idx, text }) => {
      const row = [...document.querySelectorAll("#profilesBody tr")].find((entry) => entry.textContent?.includes(name));
      const cell = row?.querySelectorAll("td")[idx];
      return (cell?.textContent ?? "").trim() === text;
    },
    { name: profileName, idx: cellIndex, text: expected },
    { timeout: 12_000 }
  );
};

const clickRowAction = async (page: Page, profileName: string, buttonName: string) => {
  await page.locator("#profilesBody tr", { hasText: profileName }).first().getByRole("button", { name: buttonName }).click();
};

const getRowProfileId = async (page: Page, profileName: string): Promise<string> => {
  const profileId = await page.evaluate((name) => {
    const row = [...document.querySelectorAll("#profilesBody tr")].find((entry) => entry.textContent?.includes(name));
    const idCell = row?.querySelectorAll("td")[1];
    return idCell?.textContent?.trim() ?? "";
  }, profileName);
  if (!profileId) {
    throw new Error(`Could not resolve profile id for ${profileName}`);
  }
  return profileId;
};

const screenshotStep = async (page: Page, baseDir: string, fileName: string) => {
  await page.screenshot({ path: path.join(baseDir, fileName), fullPage: true });
};

const run = async (): Promise<void> => {
  let tempDir = "";
  let app: ReturnType<typeof buildServer> | null = null;
  const startedAt = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactRoot = path.join(process.cwd(), "artifacts", "ui-subagents", startedAt);
  await mkdir(artifactRoot, { recursive: true });

  const reports: AgentReport[] = [];
  try {
    tempDir = await createTempDir("ui-subagent-run-");
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
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve server address.");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      page.on("dialog", async (dialog) => {
        await dialog.accept();
      });
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

      {
        const name = "UI Agent 1 - Routing + Connection";
        const dir = path.join(artifactRoot, "agent-1-routing-connection");
        await mkdir(dir, { recursive: true });
        const details: string[] = [];
        let checksPassed = 0;
        const checksTotal = 4;

        if (new URL(page.url()).pathname === "/app") {
          checksPassed += 1;
          details.push("Root URL redirects to /app.");
        }
        await screenshotStep(page, dir, "01-root-redirect.png");

        await page.fill("#apiToken", "subagent-token");
        await page.click("#saveTokenBtn");
        await page.waitForFunction(() => localStorage.getItem("codex-ai-browser-api-token") === "subagent-token");
        checksPassed += 1;
        details.push("Save Token persists API token in localStorage.");
        await screenshotStep(page, dir, "02-token-saved.png");

        await page.click("#clearTokenBtn");
        await page.waitForFunction(() => localStorage.getItem("codex-ai-browser-api-token") === null);
        checksPassed += 1;
        details.push("Clear Token removes stored API token.");
        await screenshotStep(page, dir, "03-token-cleared.png");

        await page.click("#refreshBtn");
        await page.waitForFunction(
          () => (document.querySelector("#profileActionStatus")?.textContent ?? "").toLowerCase().includes("complete")
        );
        checksPassed += 1;
        details.push("Refresh button executes and returns status.");
        await screenshotStep(page, dir, "04-refresh.png");

        reports.push({
          name,
          score: Math.round((checksPassed / checksTotal) * 100),
          checksPassed,
          checksTotal,
          details
        });
      }

      {
        const name = "UI Agent 2 - Profile Lifecycle + Visibility + Delete";
        const dir = path.join(artifactRoot, "agent-2-lifecycle");
        await mkdir(dir, { recursive: true });
        const details: string[] = [];
        let checksPassed = 0;
        const checksTotal = 8;

        const profileName = "Agent Profile Lifecycle";
        await page.check("#profileHeadless");
        await page.fill("#profileName", profileName);
        await page.click("#createProfileBtn");
        await waitForRow(page, profileName);
        checksPassed += 1;
        details.push("Create profile works from UI form.");
        await screenshotStep(page, dir, "01-created.png");

        await assertRowCell(page, profileName, 4, "Hidden");
        checksPassed += 1;
        details.push("New profile starts in Hidden mode when checkbox selected.");

        await clickRowAction(page, profileName, "Start");
        await assertRowCell(page, profileName, 3, "Yes");
        checksPassed += 1;
        details.push("Start button changes running state to Yes.");
        await screenshotStep(page, dir, "02-started.png");

        await clickRowAction(page, profileName, "Show Browser");
        await assertRowCell(page, profileName, 4, "Visible");
        checksPassed += 1;
        details.push("Show Browser toggles mode to Visible.");
        await screenshotStep(page, dir, "03-visible.png");

        await clickRowAction(page, profileName, "Hide Browser");
        await assertRowCell(page, profileName, 4, "Hidden");
        checksPassed += 1;
        details.push("Hide Browser toggles mode back to Hidden.");
        await screenshotStep(page, dir, "04-hidden.png");

        await clickRowAction(page, profileName, "Stop");
        await assertRowCell(page, profileName, 3, "No");
        checksPassed += 1;
        details.push("Stop button changes running state to No.");
        await screenshotStep(page, dir, "05-stopped.png");

        const disposableName = "Delete Me Profile";
        await page.fill("#profileName", disposableName);
        await page.click("#createProfileBtn");
        await waitForRow(page, disposableName);
        await clickRowAction(page, disposableName, "Delete");
        await page.waitForFunction(
          (name) => ![...document.querySelectorAll("#profilesBody tr")].some((row) => row.textContent?.includes(name)),
          disposableName,
          { timeout: 12_000 }
        );
        checksPassed += 1;
        details.push("Delete profile removes row from table.");
        await screenshotStep(page, dir, "06-deleted.png");

        await page.uncheck("#profileHeadless");
        checksPassed += 1;
        details.push("Headless checkbox can be toggled back for visible-default creation.");

        reports.push({
          name,
          score: Math.round((checksPassed / checksTotal) * 100),
          checksPassed,
          checksTotal,
          details
        });
      }

      {
        const name = "UI Agent 3 - Active Control + Commands";
        const dir = path.join(artifactRoot, "agent-3-control-commands");
        await mkdir(dir, { recursive: true });
        const details: string[] = [];
        let checksPassed = 0;
        const checksTotal = 7;

        const profileName = "Agent Profile Commands";
        await page.fill("#profileName", profileName);
        await page.click("#createProfileBtn");
        await waitForRow(page, profileName);
        const profileId = await getRowProfileId(page, profileName);

        await clickRowAction(page, profileName, "Set Active");
        await page.waitForFunction(
          (id) => (document.querySelector("#activeState")?.textContent ?? "").includes(id),
          profileId,
          { timeout: 12_000 }
        );
        checksPassed += 1;
        details.push("Set Active updates takeover state.");
        await screenshotStep(page, dir, "01-set-active.png");

        await page.fill("#targetUrl", "https://example.com/");
        await clickRowAction(page, profileName, "Open URL");
        await page.waitForFunction(
          () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"navigate\"")
        );
        checksPassed += 1;
        details.push("Open URL row action runs navigation command.");
        await screenshotStep(page, dir, "02-open-url-row.png");

        await page.click("#goBtn");
        await page.waitForFunction(
          () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"navigate\"")
        );
        checksPassed += 1;
        details.push("Navigate Active Profile button runs active navigation.");

        await page.click("#listTabsBtn");
        await page.waitForFunction(
          () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"listTabs\"")
        );
        checksPassed += 1;
        details.push("List Tabs command works.");

        await page.fill("#tabIndexInput", "0");
        await page.click("#setTabBtn");
        await page.waitForFunction(
          () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"selectTab\"")
        );
        checksPassed += 1;
        details.push("Set Active Tab command works for tab 0.");

        await page.click("#readTabBtn");
        await page.waitForFunction(
          () => (document.querySelector("#commandResult")?.textContent ?? "").includes("\"getTabText\"")
        );
        checksPassed += 1;
        details.push("Read Tab Text command works for tab 0.");
        await screenshotStep(page, dir, "03-commands.png");

        await page.click("#releaseBtn");
        await page.waitForFunction(
          () => (document.querySelector("#activeState")?.textContent ?? "").includes("none"),
          undefined,
          { timeout: 12_000 }
        );
        checksPassed += 1;
        details.push("Release Active Profile clears active state.");
        await screenshotStep(page, dir, "04-released.png");

        reports.push({
          name,
          score: Math.round((checksPassed / checksTotal) * 100),
          checksPassed,
          checksTotal,
          details
        });
      }

      {
        const name = "UI Agent 4 - Presets";
        const dir = path.join(artifactRoot, "agent-4-presets");
        await mkdir(dir, { recursive: true });
        const details: string[] = [];
        let checksPassed = 0;
        const checksTotal = 3;

        await page.click("#ensureBrowserBtn");
        await page.waitForFunction(
          () => (document.querySelector("#geminiStatus")?.textContent ?? "").toLowerCase().includes("complete"),
          undefined,
          { timeout: 12_000 }
        );
        checksPassed += 1;
        details.push("Ensure Browser Profile button works.");
        await screenshotStep(page, dir, "01-ensure-browser.png");

        await page.click("#openGeminiBtn");
        await page.waitForFunction(
          () => (document.querySelector("#geminiStatus")?.textContent ?? "").toLowerCase().includes("complete"),
          undefined,
          { timeout: 12_000 }
        );
        checksPassed += 1;
        details.push("Open Gemini button triggers preset open flow.");
        await screenshotStep(page, dir, "02-open-gemini.png");

        await page.click("#stopAllBtn");
        await page.waitForFunction(
          () => (document.querySelector("#profileActionStatus")?.textContent ?? "").toLowerCase().includes("complete"),
          undefined,
          { timeout: 12_000 }
        );
        checksPassed += 1;
        details.push("Stop All Profiles button works.");
        await screenshotStep(page, dir, "03-stop-all.png");

        reports.push({
          name,
          score: Math.round((checksPassed / checksTotal) * 100),
          checksPassed,
          checksTotal,
          details
        });
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (app) {
      await app.close();
    }
    if (tempDir) {
      await removeDir(tempDir);
    }
  }

  const overall = Math.round(reports.reduce((sum, report) => sum + report.score, 0) / reports.length);
  const output = {
    mode: "ui-subagent-run",
    overall,
    passedThreshold: overall >= 90,
    reports
  };

  const reportPath = path.join(artifactRoot, "report.json");
  await writeFile(reportPath, JSON.stringify(output, null, 2), "utf-8");
  console.log(JSON.stringify({ artifactRoot, reportPath, ...output }, null, 2));

  if (overall < 90) {
    process.exitCode = 1;
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
