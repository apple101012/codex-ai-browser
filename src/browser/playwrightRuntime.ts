import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type BrowserContext, type BrowserType, type Page } from "playwright";
import type { BrowserRuntime } from "./runtime.js";
import type { BrowserCommand, CommandExecutionResult } from "../domain/commands.js";
import type { ProfileRecord } from "../domain/profile.js";

type PageCommand = Exclude<
  BrowserCommand,
  | { type: "listTabs" }
  | { type: "newTab" }
  | { type: "selectTab" }
  | { type: "closeTab" }
  | { type: "getTabText" }
>;

interface SessionState {
  context: BrowserContext;
  activePage: Page;
}

export interface PlaywrightRuntimeOptions {
  artifactsDir: string;
  defaultHeadless: boolean;
  allowEvaluate: boolean;
}

export class PlaywrightRuntime implements BrowserRuntime {
  private readonly sessions = new Map<string, SessionState>();
  private readonly artifactsDir: string;
  private readonly defaultHeadless: boolean;
  private readonly allowEvaluate: boolean;

  constructor(options: PlaywrightRuntimeOptions) {
    this.artifactsDir = options.artifactsDir;
    this.defaultHeadless = options.defaultHeadless;
    this.allowEvaluate = options.allowEvaluate;
  }

  async start(profile: ProfileRecord): Promise<void> {
    if (this.sessions.has(profile.id)) {
      return;
    }

    await mkdir(profile.dataDir, { recursive: true });
    await mkdir(this.artifactsDir, { recursive: true });

    const browserType = this.resolveBrowserType(profile.engine);
    const context = await browserType.launchPersistentContext(profile.dataDir, {
      headless: profile.settings.headless ?? this.defaultHeadless,
      proxy: profile.settings.proxy
        ? {
            server: profile.settings.proxy.server,
            username: profile.settings.proxy.username,
            password: profile.settings.proxy.password
          }
        : undefined,
      userAgent: profile.settings.userAgent
    });

    const activePage = context.pages()[0] ?? (await context.newPage());
    this.sessions.set(profile.id, { context, activePage });
  }

  async stop(profileId: string): Promise<void> {
    const session = this.sessions.get(profileId);
    if (!session) {
      return;
    }
    await session.context.close();
    this.sessions.delete(profileId);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((profileId) => this.stop(profileId)));
  }

  isRunning(profileId: string): boolean {
    return this.sessions.has(profileId);
  }

  listRunningIds(): string[] {
    return [...this.sessions.keys()];
  }

  async execute(profile: ProfileRecord, command: BrowserCommand): Promise<CommandExecutionResult> {
    const session = this.sessions.get(profile.id);
    if (!session) {
      throw new Error(`Profile ${profile.id} is not running.`);
    }

    switch (command.type) {
      case "listTabs": {
        const tabs = await this.listTabs(session);
        return { type: command.type, ok: true, data: { tabs } };
      }
      case "newTab": {
        const page = await session.context.newPage();
        if (command.url) {
          await page.goto(command.url, { waitUntil: "domcontentloaded" });
        }
        session.activePage = page;
        const tabs = await this.listTabs(session);
        const activeTabIndex = tabs.findIndex((tab) => tab.active);
        return { type: command.type, ok: true, data: { activeTabIndex, tabs } };
      }
      case "selectTab": {
        const page = this.getPageByIndex(session, command.tabIndex);
        session.activePage = page;
        await page.bringToFront();
        return {
          type: command.type,
          ok: true,
          data: {
            tabIndex: command.tabIndex,
            url: page.url(),
            title: await page.title()
          }
        };
      }
      case "closeTab": {
        const page = command.tabIndex === undefined
          ? this.getActivePage(session)
          : this.getPageByIndex(session, command.tabIndex);
        await page.close();
        session.activePage = this.getActivePage(session);
        return {
          type: command.type,
          ok: true,
          data: { tabs: await this.listTabs(session) }
        };
      }
      case "getTabText": {
        const page = this.getPageByIndex(session, command.tabIndex);
        const text = await page.evaluate((maxChars) => {
          const raw = document.body?.innerText ?? "";
          return raw.slice(0, maxChars);
        }, command.maxChars ?? 4000);
        return {
          type: command.type,
          ok: true,
          data: {
            tabIndex: command.tabIndex,
            url: page.url(),
            title: await page.title(),
            text
          }
        };
      }
      default: {
        const page = this.getActivePage(session);
        return await this.executePageCommand(profile, command as PageCommand, page);
      }
    }
  }

  private async executePageCommand(
    profile: ProfileRecord,
    command: PageCommand,
    page: Page
  ): Promise<CommandExecutionResult> {
    switch (command.type) {
      case "navigate": {
        await page.goto(command.url, { waitUntil: command.waitUntil ?? "domcontentloaded" });
        return {
          type: command.type,
          ok: true,
          data: {
            url: page.url(),
            title: await page.title()
          }
        };
      }
      case "click": {
        await page.click(command.selector, { timeout: command.timeoutMs ?? 10_000 });
        return { type: command.type, ok: true };
      }
      case "type": {
        if (command.clear) {
          await page.fill(command.selector, command.text);
        } else {
          await page.locator(command.selector).type(command.text);
        }
        return { type: command.type, ok: true };
      }
      case "press": {
        await page.keyboard.press(command.key);
        return { type: command.type, ok: true };
      }
      case "extractText": {
        const text = await page.locator(command.selector).first().innerText();
        return { type: command.type, ok: true, data: { text } };
      }
      case "getPageState": {
        const title = await page.title();
        const url = page.url();
        const html = command.includeHtml ? await page.content() : undefined;
        const textExcerpt = command.includeTextExcerpt
          ? await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? "")
          : undefined;

        return {
          type: command.type,
          ok: true,
          data: {
            url,
            title,
            html,
            textExcerpt
          }
        };
      }
      case "screenshot": {
        const fileName = this.resolveScreenshotPath(profile.id, command.path);
        await page.screenshot({ path: fileName, fullPage: command.fullPage ?? false });
        return {
          type: command.type,
          ok: true,
          data: { path: fileName }
        };
      }
      case "evaluate": {
        if (!this.allowEvaluate) {
          throw new Error("evaluate command is disabled. Set ALLOW_EVALUATE=true to enable it.");
        }
        const result = await page.evaluate((expression) => {
          return eval(expression);
        }, command.expression);
        return { type: command.type, ok: true, data: result };
      }
      default: {
        const unreachable: never = command;
        throw new Error(`Unsupported command ${(unreachable as { type?: string }).type ?? "unknown"}`);
      }
    }
  }

  private async listTabs(session: SessionState): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    const pages = session.context.pages().filter((page) => !page.isClosed());
    if (pages.length === 0) {
      const page = await session.context.newPage();
      session.activePage = page;
    }

    const currentPages = session.context.pages().filter((page) => !page.isClosed());
    return await Promise.all(
      currentPages.map(async (page, index) => ({
        index,
        url: page.url(),
        title: await page.title(),
        active: page === session.activePage
      }))
    );
  }

  private getActivePage(session: SessionState): Page {
    if (!session.activePage.isClosed()) {
      return session.activePage;
    }

    const fallback = session.context.pages().find((page) => !page.isClosed());
    if (!fallback) {
      throw new Error("No open tabs available.");
    }
    session.activePage = fallback;
    return fallback;
  }

  private getPageByIndex(session: SessionState, index: number): Page {
    const pages = session.context.pages().filter((page) => !page.isClosed());
    const page = pages[index];
    if (!page) {
      throw new Error(`Tab index ${index} is out of range.`);
    }
    return page;
  }

  private resolveBrowserType(engine: ProfileRecord["engine"]): BrowserType {
    return engine === "firefox" ? firefox : chromium;
  }

  private resolveScreenshotPath(profileId: string, inputPath: string | undefined): string {
    if (!inputPath) {
      return path.join(this.artifactsDir, `${profileId}-${Date.now()}.png`);
    }

    if (path.isAbsolute(inputPath)) {
      throw new Error("Absolute screenshot paths are not allowed.");
    }

    return path.join(this.artifactsDir, inputPath);
  }
}
