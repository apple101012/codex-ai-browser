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
  profileId: string;
  context: BrowserContext;
  activePage: Page;
  closed: boolean;
  boundPages: WeakSet<Page>;
}

export interface PlaywrightRuntimeOptions {
  artifactsDir: string;
  defaultHeadless: boolean;
  allowEvaluate: boolean;
}

export class PlaywrightRuntime implements BrowserRuntime {
  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingContextCloses = new Set<Promise<void>>();
  private readonly artifactsDir: string;
  private readonly defaultHeadless: boolean;
  private readonly allowEvaluate: boolean;

  constructor(options: PlaywrightRuntimeOptions) {
    this.artifactsDir = options.artifactsDir;
    this.defaultHeadless = options.defaultHeadless;
    this.allowEvaluate = options.allowEvaluate;
  }

  async start(profile: ProfileRecord): Promise<void> {
    if (this.isRunning(profile.id)) {
      return;
    }

    await mkdir(profile.dataDir, { recursive: true });
    await mkdir(this.artifactsDir, { recursive: true });

    const context = await this.launchContext(profile);
    const initialPage = context.pages().find((page) => !page.isClosed()) ?? (await context.newPage());
    const session: SessionState = {
      profileId: profile.id,
      context,
      activePage: initialPage,
      closed: false,
      boundPages: new WeakSet<Page>()
    };
    this.bindPageLifecycle(session, initialPage);
    for (const page of context.pages()) {
      this.bindPageLifecycle(session, page);
    }
    context.on("page", (page) => {
      this.bindPageLifecycle(session, page);
      session.activePage = page;
    });
    context.on("close", () => {
      this.markSessionClosed(session);
    });
    this.sessions.set(profile.id, session);
  }

  async stop(profileId: string): Promise<void> {
    const session = this.sessions.get(profileId);
    if (!session) {
      return;
    }
    this.markSessionClosed(session);
    await this.closeContext(session.context);
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((profileId) => this.stop(profileId)));
    if (this.pendingContextCloses.size > 0) {
      await Promise.all([...this.pendingContextCloses]);
    }
  }

  isRunning(profileId: string): boolean {
    const session = this.sessions.get(profileId);
    return Boolean(session && !session.closed);
  }

  listRunningIds(): string[] {
    return [...this.sessions.entries()]
      .filter(([, session]) => !session.closed)
      .map(([profileId]) => profileId);
  }

  async execute(profile: ProfileRecord, command: BrowserCommand): Promise<CommandExecutionResult> {
    const session = this.sessions.get(profile.id);
    if (!session || session.closed) {
      throw new Error(`Profile ${profile.id} is not running.`);
    }

    switch (command.type) {
      case "listTabs": {
        const tabs = await this.listTabs(profile.id, session);
        return { type: command.type, ok: true, data: { tabs } };
      }
      case "newTab": {
        const page = await session.context.newPage();
        if (command.url) {
          await page.goto(command.url, { waitUntil: "domcontentloaded" });
        }
        session.activePage = page;
        const tabs = await this.listTabs(profile.id, session);
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
        const tabs = await this.listTabs(profile.id, session);
        if (tabs.length > 0) {
          session.activePage = this.getActivePage(session);
        }
        return {
          type: command.type,
          ok: true,
          data: { tabs }
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

  private async listTabs(
    profileId: string,
    session: SessionState
  ): Promise<Array<{ index: number; url: string; title: string; active: boolean }>> {
    const currentPages = session.context.pages().filter((page) => !page.isClosed());
    if (currentPages.length === 0) {
      this.markSessionClosed(session);
      return [];
    }

    if (session.activePage.isClosed()) {
      session.activePage = currentPages[0] as Page;
    }

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
      this.markSessionClosed(session);
      throw new Error("No open tabs available. Browser appears closed; start the profile again.");
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

  private resolveChannel(engine: ProfileRecord["engine"]): "chrome" | "msedge" | undefined {
    if (engine === "chrome" || engine === "msedge") {
      return engine;
    }
    return undefined;
  }

  private async launchContext(profile: ProfileRecord): Promise<BrowserContext> {
    const browserType = this.resolveBrowserType(profile.engine);
    const channel = this.resolveChannel(profile.engine);
    const launchOptions = {
      headless: profile.settings.headless ?? this.defaultHeadless,
      proxy: profile.settings.proxy
        ? {
            server: profile.settings.proxy.server,
            username: profile.settings.proxy.username,
            password: profile.settings.proxy.password
          }
        : undefined,
      userAgent: profile.settings.userAgent,
      channel,
      ignoreDefaultArgs: channel ? ["--enable-automation"] : undefined,
      args: channel ? ["--disable-blink-features=AutomationControlled"] : undefined
    };

    try {
      return await browserType.launchPersistentContext(profile.dataDir, launchOptions);
    } catch (error) {
      if (channel) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to launch ${channel} browser channel for profile ${profile.id}. ` +
            `Install and open ${channel} once, then retry. Original error: ${message}`
        );
      }
      throw error;
    }
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

  private bindPageLifecycle(session: SessionState, page: Page): void {
    if (session.boundPages.has(page)) {
      return;
    }
    session.boundPages.add(page);
    page.on("close", () => {
      this.handlePageClosed(session, page);
    });
  }

  private handlePageClosed(session: SessionState, closedPage: Page): void {
    if (session.closed) {
      return;
    }
    if (session.activePage === closedPage) {
      const fallback = session.context.pages().find((page) => !page.isClosed());
      if (fallback) {
        session.activePage = fallback;
      }
    }

    const openPages = session.context.pages().filter((page) => !page.isClosed());
    if (openPages.length === 0) {
      this.markSessionClosed(session);
      void this.closeContext(session.context);
    }
  }

  private markSessionClosed(session: SessionState): void {
    if (session.closed) {
      return;
    }
    session.closed = true;
    this.sessions.delete(session.profileId);
  }

  private async closeContext(context: BrowserContext): Promise<void> {
    const closePromise = context.close().catch(() => undefined);
    this.pendingContextCloses.add(closePromise);
    try {
      await closePromise;
    } finally {
      this.pendingContextCloses.delete(closePromise);
    }
  }
}
