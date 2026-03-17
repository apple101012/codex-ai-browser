import os from "node:os";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { startServer } from "../src/serverApp.js";

interface CreatedProfile {
  id: string;
  name: string;
}

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const privateRoot = path.join(
  os.homedir(),
  ".codex-private-artifacts",
  "codex-ai-browser",
  `practice-${timestamp}`
);
const screenshotDir = path.join(privateRoot, "screenshots");
const port = 4517;
const host = "127.0.0.1";
const apiBase = `http://${host}:${port}`;

const jsonRequest = async <T>(targetPath: string, init: RequestInit = {}): Promise<T> => {
  const mergedHeaders: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined)
  };
  if (init.body !== undefined && !("content-type" in mergedHeaders)) {
    mergedHeaders["content-type"] = "application/json";
  }

  const response = await fetch(`${apiBase}${targetPath}`, {
    ...init,
    headers: mergedHeaders
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) ${targetPath}: ${JSON.stringify(payload)}`);
  }
  return payload as T;
};

const htmlDataUrl = (title: string, bodyText: string): string => {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body><h1>${title}</h1><p>${bodyText}</p></body></html>`;
  return `data:text/html,${encodeURIComponent(html)}`;
};

const run = async (): Promise<void> => {
  await mkdir(screenshotDir, { recursive: true });
  const runtimeDataDir = path.join(privateRoot, "runtime-data");
  process.env.DATA_DIR = runtimeDataDir;
  process.env.DEFAULT_HEADLESS = "true";
  process.env.ALLOW_EVALUATE = "false";
  process.env.HOST = host;
  process.env.PORT = String(port);

  const server = await startServer({
    host,
    port,
    registerSignalHandlers: false
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const profiles: CreatedProfile[] = [];
    for (const name of ["Visual Profile A", "Visual Profile B", "Visual Profile C"]) {
      const created = await jsonRequest<{ profile: { id: string; name: string } }>("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name,
          engine: "chromium",
          settings: {
            headless: true
          }
        })
      });
      profiles.push({
        id: created.profile.id,
        name: created.profile.name
      });
    }

    for (let index = 0; index < profiles.length; index += 1) {
      const profile = profiles[index];
      await jsonRequest(`/profiles/${profile.id}/start`, { method: "POST" });
      await jsonRequest(`/profiles/${profile.id}/commands`, {
        method: "POST",
        body: JSON.stringify({
          autoStart: true,
          commands: [
            {
              type: "navigate",
              url: htmlDataUrl(`${profile.name} Main`, `Practice run page ${index + 1}`)
            },
            {
              type: "newTab",
              url: htmlDataUrl(`${profile.name} Tab 2`, `Secondary tab ${index + 1}`)
            },
            {
              type: "screenshot",
              path: `profile-${index + 1}-tab-2.png`,
              fullPage: true
            },
            {
              type: "selectTab",
              tabIndex: 0
            },
            {
              type: "screenshot",
              path: `profile-${index + 1}-tab-1.png`,
              fullPage: true
            }
          ]
        })
      });
    }

    await jsonRequest("/control/active-profile", {
      method: "POST",
      body: JSON.stringify({
        profileId: profiles[1]?.id,
        autoStart: true
      })
    });

    await jsonRequest("/control/active/commands", {
      method: "POST",
      body: JSON.stringify({
        commands: [{ type: "listTabs" }, { type: "getTabText", tabIndex: 0, maxChars: 1000 }]
      })
    });

    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${apiBase}/app`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => document.querySelectorAll("#profilesBody tr").length >= 3,
      undefined,
      { timeout: 10_000 }
    );
    await page.screenshot({
      path: path.join(screenshotDir, "01-control-initial.png"),
      fullPage: true
    });

    await page.click("#refreshBtn");
    await page.waitForFunction(
      () => document.querySelectorAll("#profilesBody tr").length >= 3,
      undefined,
      { timeout: 10_000 }
    );
    await page.screenshot({
      path: path.join(screenshotDir, "02-control-after-refresh.png"),
      fullPage: true
    });

    await page.fill("#targetUrl", "https://example.com/");
    await page.click("#goBtn");
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(screenshotDir, "03-control-after-navigate-command.png"),
      fullPage: true
    });

    await page.click("#listTabsBtn");
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotDir, "04-control-after-list-tabs.png"),
      fullPage: true
    });

    await page.fill("#tabIndexInput", "0");
    await page.click("#readTabBtn");
    await page.waitForTimeout(400);
    await page.screenshot({
      path: path.join(screenshotDir, "05-control-after-read-tab.png"),
      fullPage: true
    });

    const report = {
      generatedAt: new Date().toISOString(),
      apiBase,
      screenshots: {
        ui: [
          path.join(screenshotDir, "01-control-initial.png"),
          path.join(screenshotDir, "02-control-after-refresh.png"),
          path.join(screenshotDir, "03-control-after-navigate-command.png"),
          path.join(screenshotDir, "04-control-after-list-tabs.png"),
          path.join(screenshotDir, "05-control-after-read-tab.png")
        ],
        runtimeArtifactsDir: path.join(runtimeDataDir, "artifacts")
      },
      profiles
    };

    await writeFile(path.join(privateRoot, "practice-report.json"), JSON.stringify(report, null, 2), "utf8");
    console.log(`Practice run complete. Report: ${path.join(privateRoot, "practice-report.json")}`);
  } finally {
    if (browser) {
      await browser.close();
    }
    await server.close();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
