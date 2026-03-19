import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, firefox, type BrowserContext, type BrowserType, type Page } from "playwright";
import type { BrowserRuntime } from "./runtime.js";
import type { BrowserCommand, CommandExecutionResult } from "../domain/commands.js";
import type { ProfileRecord } from "../domain/profile.js";
import type { ProfileStore } from "../storage/profileStore.js";

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
  lastKnownTabs: Array<{ url: string; active: boolean }>;
  pendingCloseSnapshotTimer: NodeJS.Timeout | null;
}

export interface PlaywrightRuntimeOptions {
  artifactsDir: string;
  defaultHeadless: boolean;
  allowEvaluate: boolean;
  profileStore?: ProfileStore;
}

export class PlaywrightRuntime implements BrowserRuntime {
  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingContextCloses = new Set<Promise<void>>();
  private readonly artifactsDir: string;
  private readonly defaultHeadless: boolean;
  private readonly allowEvaluate: boolean;
  private readonly profileStore?: ProfileStore;

  constructor(options: PlaywrightRuntimeOptions) {
    this.artifactsDir = options.artifactsDir;
    this.defaultHeadless = options.defaultHeadless;
    this.allowEvaluate = options.allowEvaluate;
    this.profileStore = options.profileStore;
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
      boundPages: new WeakSet<Page>(),
      lastKnownTabs: [],
      pendingCloseSnapshotTimer: null
    };
    this.bindPageLifecycle(session, initialPage);
    for (const page of context.pages()) {
      this.bindPageLifecycle(session, page);
    }
    context.on("page", (page) => {
      this.bindPageLifecycle(session, page);
      session.activePage = page;
      this.updateSessionTabSnapshot(session);
    });
    context.on("close", () => {
      this.clearPendingCloseSnapshot(session);
      this.markSessionClosed(session);
    });
    this.sessions.set(profile.id, session);

    // Restore saved tabs if available
    await this.restoreSavedTabs(session, profile);
    this.updateSessionTabSnapshot(session);
  }

  async stop(profileId: string): Promise<void> {
    const session = this.sessions.get(profileId);
    if (!session) {
      return;
    }

    this.clearPendingCloseSnapshot(session);
    this.updateSessionTabSnapshot(session);

    // Save current tabs before stopping
    await this.saveCurrentTabs(session);

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
        this.updateSessionTabSnapshot(session);
        const tabs = await this.listTabs(profile.id, session);
        const activeTabIndex = tabs.findIndex((tab) => tab.active);
        return { type: command.type, ok: true, data: { activeTabIndex, tabs } };
      }
      case "selectTab": {
        const page = this.getPageByIndex(session, command.tabIndex);
        session.activePage = page;
        await page.bringToFront();
        this.updateSessionTabSnapshot(session);
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
        this.updateSessionTabSnapshot(session);
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
        const session = this.sessions.get(profile.id);
        if (session) {
          this.updateSessionTabSnapshot(session);
        }
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
    const isFirefox = profile.engine === "firefox";
    
    const launchOptions = {
      headless: profile.settings.headless ?? this.defaultHeadless,
      chromiumSandbox: !isFirefox ? true : undefined,
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
      args: undefined,
      // Firefox-specific preferences to enable keyboard shortcuts in automation mode
      // Note: These preferences allow MANUAL keyboard shortcuts by the user,
      // but programmatic shortcuts via page.keyboard.press() may still be limited
      firefoxUserPrefs: isFirefox
        ? {
            // Key preferences for enabling manual keyboard shortcuts:
            // Disable WebDriver mode that blocks browser shortcuts
            "dom.webdriver.enabled": false,
            // Allow full browser functionality (not restricted automation mode)
            "marionette.webdriver": false,
            // Ensure keyboard shortcuts are enabled
            "browser.shortcuts.enabled": true,
            // Additional preferences for better compatibility
            "browser.tabs.remote.autostart": true,
            "browser.tabs.remote.autostart.2": true
          }
        : undefined
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
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.updateSessionTabSnapshot(session);
      }
    });
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
      // Keep the latest snapshot and persist before marking session as closed.
      this.clearPendingCloseSnapshot(session);
      void this.saveCurrentTabs(session).then(() => {
        this.markSessionClosed(session);
        void this.closeContext(session.context);
      });
      return;
    }

    this.scheduleSnapshotUpdateAfterClose(session);
  }

  private markSessionClosed(session: SessionState): void {
    if (session.closed) {
      return;
    }
    this.clearPendingCloseSnapshot(session);
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

  private async saveCurrentTabs(session: SessionState): Promise<void> {
    if (!this.profileStore) {
      return;
    }

    try {
      const currentPages = session.context.pages().filter((page) => !page.isClosed());
      let snapshot = this.normalizeTabs(
        currentPages.map((page) => ({
          url: page.url(),
          active: page === session.activePage
        }))
      );

      // If all pages are gone (manual close / Alt+F4), fallback to the latest cached snapshot.
      if (snapshot.length === 0) {
        snapshot = this.normalizeTabs(session.lastKnownTabs);
      } else {
        session.lastKnownTabs = snapshot;
      }

      const savedTabs = snapshot.filter((tab) => this.isPersistableTabUrl(tab.url));
      await this.profileStore.saveTabs(session.profileId, savedTabs);
    } catch (error) {
      // Ignore errors during tab saving to not block shutdown
      console.error(`Failed to save tabs for profile ${session.profileId}:`, error);
    }
  }

  private async restoreSavedTabs(session: SessionState, profile: ProfileRecord): Promise<void> {
    const savedTabs = this.normalizeTabs(profile.savedTabs ?? []).filter((tab) => this.isPersistableTabUrl(tab.url));
    if (savedTabs.length === 0) {
      return;
    }

    try {
      const currentPages = session.context.pages().filter((page) => !page.isClosed());

      // Browser channels can auto-restore tabs from profile state; avoid duplicating tabs in that case.
      const hasRestoredPagesAlready = currentPages.some((page) => this.isPersistableTabUrl(page.url()));
      if (hasRestoredPagesAlready) {
        const matchingActive = currentPages.find((page) =>
          savedTabs.some((tab) => tab.active && tab.url === page.url())
        );
        session.activePage = matchingActive ?? currentPages[0] ?? session.activePage;
        if (!session.activePage.isClosed()) {
          await session.activePage.bringToFront();
        }
        return;
      }

      const restored: Array<{ page: Page; index: number }> = [];
      const targetActiveIndex = Math.max(
        0,
        savedTabs.findIndex((tab) => tab.active)
      );

      // Reuse the initial page for the first restore to avoid opening then closing a blank tab.
      const firstPage = currentPages[0] ?? (await session.context.newPage());
      try {
        await firstPage.goto(savedTabs[0]?.url ?? "about:blank", {
          waitUntil: "domcontentloaded",
          timeout: 15_000
        });
        restored.push({ page: firstPage, index: 0 });
      } catch (error) {
        console.warn(`Failed to restore tab ${savedTabs[0]?.url ?? ""}:`, error);
      }

      const remainingRestores = savedTabs.slice(1).map(async (savedTab, offset) => {
        const page = await session.context.newPage();
        await page.goto(savedTab.url, {
          waitUntil: "domcontentloaded",
          timeout: 15_000
        });
        return { page, index: offset + 1 };
      });

      const remainingResults = await Promise.allSettled(remainingRestores);
      for (let i = 0; i < remainingResults.length; i += 1) {
        const result = remainingResults[i];
        if (result?.status === "fulfilled") {
          restored.push(result.value);
          continue;
        }
        const failedUrl = savedTabs[i + 1]?.url ?? "";
        console.warn(`Failed to restore tab ${failedUrl}:`, result?.reason);
      }

      const activeRestored =
        restored.find((entry) => entry.index === targetActiveIndex)?.page ??
        restored[0]?.page;

      if (activeRestored) {
        session.activePage = activeRestored;
        if (!activeRestored.isClosed()) {
          await activeRestored.bringToFront();
        }
      } else {
        const fallback = session.context.pages().find((page) => !page.isClosed());
        if (fallback) {
          session.activePage = fallback;
        }
      }
    } catch (error) {
      // If restoration fails, log but don't crash
      console.error(`Failed to restore tabs for profile ${profile.id}:`, error);
    }
  }

  private updateSessionTabSnapshot(session: SessionState): void {
    if (session.closed) {
      return;
    }
    const currentPages = session.context.pages().filter((page) => !page.isClosed());
    if (currentPages.length === 0) {
      return;
    }
    if (session.activePage.isClosed()) {
      session.activePage = currentPages[0] as Page;
    }
    session.lastKnownTabs = this.normalizeTabs(
      currentPages.map((page) => ({
        url: page.url(),
        active: page === session.activePage
      }))
    );
  }

  private scheduleSnapshotUpdateAfterClose(session: SessionState): void {
    this.clearPendingCloseSnapshot(session);
    session.pendingCloseSnapshotTimer = setTimeout(() => {
      session.pendingCloseSnapshotTimer = null;
      this.updateSessionTabSnapshot(session);
    }, 300);
  }

  private clearPendingCloseSnapshot(session: SessionState): void {
    if (!session.pendingCloseSnapshotTimer) {
      return;
    }
    clearTimeout(session.pendingCloseSnapshotTimer);
    session.pendingCloseSnapshotTimer = null;
  }

  private normalizeTabs(
    tabs: Array<{ url: string; active: boolean } | undefined>
  ): Array<{ url: string; active: boolean }> {
    const normalized = tabs
      .filter((tab): tab is { url: string; active: boolean } => Boolean(tab))
      .map((tab) => ({
        url: tab.url.trim(),
        active: Boolean(tab.active)
      }))
      .filter((tab) => tab.url.length > 0);

    if (normalized.length === 0) {
      return [];
    }

    const activeIndex = normalized.findIndex((tab) => tab.active);
    if (activeIndex === -1) {
      return normalized.map((tab, index) => ({
        ...tab,
        active: index === 0
      }));
    }

    return normalized.map((tab, index) => ({
      ...tab,
      active: index === activeIndex
    }));
  }

  private isPersistableTabUrl(url: string): boolean {
    const value = url.trim().toLowerCase();
    if (value.length === 0) {
      return false;
    }

    // Skip internal placeholder pages that should not become restore state.
    if (
      value.startsWith("about:blank") ||
      value.startsWith("chrome://newtab") ||
      value.startsWith("edge://newtab")
    ) {
      return false;
    }

    return true;
  }
}
