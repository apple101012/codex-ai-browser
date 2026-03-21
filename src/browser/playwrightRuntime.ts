import { access, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { chromium, firefox, type BrowserContext, type BrowserType, type Locator, type Page } from "playwright";
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

type MouseCommand = Extract<BrowserCommand, { type: "mouse" }>;
type MouseDragCommand = Extract<BrowserCommand, { type: "mouseDrag" }>;
type MousePathCommand = Extract<BrowserCommand, { type: "mousePath" }>;
type CoordinateMouseCommand = MouseCommand | MouseDragCommand | MousePathCommand;

interface MousePoint {
  x: number;
  y: number;
}

interface MouseElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ResolvedMouseOrigin {
  origin: "viewport" | "element";
  selector?: string;
  elementBox?: MouseElementBox;
}

interface ResolvedMousePoint {
  input: MousePoint;
  resolved: MousePoint;
}

interface SessionState {
  profileId: string;
  context: BrowserContext;
  activePage: Page;
  closed: boolean;
  boundPages: WeakSet<Page>;
  lastKnownTabs: Array<{ url: string; active: boolean }>;
  pendingCloseSnapshotTimer: NodeJS.Timeout | null;
  elementRefs: Map<string, ElementRefBinding>;
  lastSnapshotId: string | null;
}

interface PageControlSummaryItem {
  index: number;
  tag: string;
  role?: string;
  type?: string;
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  testId?: string;
  selectorHint?: string;
  playwrightHint?: string;
  occurrence?: number;
  domPath?: string;
}

interface PageControlSummary {
  controls: PageControlSummaryItem[];
  primaryActions: Array<{ index: number; reason: string; selectorHint?: string }>;
  progressSignals: string[];
  suggestedTargets?: Array<{
    purpose: "prompt-input" | "submit-action" | "project-entry";
    controlIndex: number;
    selectorHint?: string;
    reason: string;
  }>;
}

interface PromptTarget {
  locator: Locator;
  index: number;
  count: number;
  meta: string;
  score: number;
  box: { x: number; y: number; width: number; height: number } | null;
}

interface ElementRefSnapshotRow {
  ref: string;
  tag: string;
  role?: string;
  text?: string;
  ariaLabel?: string;
  placeholder?: string;
}

interface ElementRefBinding extends ElementRefSnapshotRow {
  selector: string;
}

interface RefSnapshotCapture {
  snapshotId: string;
  rows: ElementRefSnapshotRow[];
  backend: "accelerated-cache" | "playwright";
}

export interface PlaywrightRuntimeOptions {
  artifactsDir: string;
  defaultHeadless: boolean;
  allowEvaluate: boolean;
  profileStore?: ProfileStore;
  enableAcceleratorExtension?: boolean;
  acceleratorExtensionDir?: string;
  enableSnapshotCache?: boolean;
}

export class PlaywrightRuntime implements BrowserRuntime {
  private readonly sessions = new Map<string, SessionState>();
  private readonly pendingContextCloses = new Set<Promise<void>>();
  private readonly artifactsDir: string;
  private readonly defaultHeadless: boolean;
  private readonly allowEvaluate: boolean;
  private readonly profileStore?: ProfileStore;
  private readonly enableAcceleratorExtension: boolean;
  private readonly acceleratorExtensionDir?: string;
  private readonly enableSnapshotCache: boolean;
  private didLogMissingAcceleratorExtension = false;
  private readonly initializedSnapshotCachePages = new WeakSet<Page>();
  private readonly snapshotHelperNonceByPage = new WeakMap<Page, string>();

  constructor(options: PlaywrightRuntimeOptions) {
    this.artifactsDir = options.artifactsDir;
    this.defaultHeadless = options.defaultHeadless;
    this.allowEvaluate = options.allowEvaluate;
    this.profileStore = options.profileStore;
    this.enableAcceleratorExtension = options.enableAcceleratorExtension ?? false;
    this.acceleratorExtensionDir = options.acceleratorExtensionDir;
    this.enableSnapshotCache = options.enableSnapshotCache ?? false;
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
      pendingCloseSnapshotTimer: null,
      elementRefs: new Map<string, ElementRefBinding>(),
      lastSnapshotId: null
    };
    this.bindPageLifecycle(session, initialPage);
    for (const page of context.pages()) {
      this.bindPageLifecycle(session, page);
    }
    context.on("page", (page) => {
      this.bindPageLifecycle(session, page);
      session.activePage = page;
      this.invalidateElementRefs(session);
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
        this.invalidateElementRefs(session);
        this.updateSessionTabSnapshot(session);
        const tabs = await this.listTabs(profile.id, session);
        const activeTabIndex = tabs.findIndex((tab) => tab.active);
        return { type: command.type, ok: true, data: { activeTabIndex, tabs } };
      }
      case "selectTab": {
        const page = this.getPageByIndex(session, command.tabIndex);
        session.activePage = page;
        await page.bringToFront();
        this.invalidateElementRefs(session);
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
        this.invalidateElementRefs(session);
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
        const page =
          command.type === "screenshot" && command.tabIndex !== undefined
            ? this.getPageByIndex(session, command.tabIndex)
            : this.getActivePage(session);
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
          this.invalidateElementRefs(session);
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
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return { type: command.type, ok: true, data: stateAfter ? { stateAfter } : undefined };
      }
      case "mouse": {
        const timeoutMs = command.timeoutMs ?? 10_000;
        const resolvedOrigin = await this.resolveMouseOrigin(page, command, timeoutMs);
        const resolvedPoint = this.resolveMousePoint(command.coordinates, resolvedOrigin);

        switch (command.action) {
          case "move":
            await page.mouse.move(resolvedPoint.resolved.x, resolvedPoint.resolved.y);
            break;
          case "down":
            await page.mouse.move(resolvedPoint.resolved.x, resolvedPoint.resolved.y);
            await page.mouse.down();
            break;
          case "up":
            await page.mouse.move(resolvedPoint.resolved.x, resolvedPoint.resolved.y);
            await page.mouse.up();
            break;
          case "click":
            await page.mouse.click(resolvedPoint.resolved.x, resolvedPoint.resolved.y);
            break;
          default: {
            const unreachableAction: never = command.action;
            throw new Error(`Unsupported mouse action ${unreachableAction}`);
          }
        }

        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });

        return {
          type: command.type,
          ok: true,
          data: {
            action: command.action,
            origin: resolvedOrigin.origin,
            selector: resolvedOrigin.selector,
            elementBox: resolvedOrigin.elementBox,
            coordinates: resolvedPoint,
            stateAfter
          }
        };
      }
      case "mouseDrag": {
        const timeoutMs = command.timeoutMs ?? 10_000;
        const resolvedOrigin = await this.resolveMouseOrigin(page, command, timeoutMs);
        const from = this.resolveMousePoint(command.from, resolvedOrigin);
        const to = this.resolveMousePoint(command.to, resolvedOrigin);

        await page.mouse.move(from.resolved.x, from.resolved.y);
        await page.mouse.down();
        await page.mouse.move(to.resolved.x, to.resolved.y, {
          steps: this.estimateMouseMoveSteps(from.resolved, to.resolved)
        });
        await page.mouse.up();

        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });

        return {
          type: command.type,
          ok: true,
          data: {
            origin: resolvedOrigin.origin,
            selector: resolvedOrigin.selector,
            elementBox: resolvedOrigin.elementBox,
            from,
            to,
            stateAfter
          }
        };
      }
      case "mousePath": {
        const timeoutMs = command.timeoutMs ?? 10_000;
        const resolvedOrigin = await this.resolveMouseOrigin(page, command, timeoutMs);
        const points = command.points.map((point) => this.resolveMousePoint(point, resolvedOrigin));
        const first = points[0];
        if (!first) {
          throw new Error("mousePath requires at least one resolved point.");
        }

        await page.mouse.move(first.resolved.x, first.resolved.y);
        await page.mouse.down();

        for (let i = 1; i < points.length; i += 1) {
          const previous = points[i - 1];
          const current = points[i];
          if (!previous || !current) {
            continue;
          }
          await page.mouse.move(current.resolved.x, current.resolved.y, {
            steps: this.estimateMouseMoveSteps(previous.resolved, current.resolved)
          });
        }

        await page.mouse.up();

        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });

        return {
          type: command.type,
          ok: true,
          data: {
            origin: resolvedOrigin.origin,
            selector: resolvedOrigin.selector,
            elementBox: resolvedOrigin.elementBox,
            points,
            pointCount: points.length,
            stateAfter
          }
        };
      }
      case "clickByText": {
        const requestedOccurrence = command.occurrence;
        const occurrence = Math.max(1, requestedOccurrence ?? 1);
        const timeoutMs = command.timeoutMs ?? 15_000;
        const tagSelector =
          command.tag === "button"
            ? "button, [role='button']"
            : command.tag === "a"
              ? "a[href], a"
              : "button, [role='button'], a[href], a";

        let locator = page.locator(tagSelector);
        if (command.exact) {
          const escaped = this.escapeRegExp(command.text.trim());
          locator = locator.filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`, "i") });
        } else {
          locator = locator.filter({ hasText: command.text });
        }

        const count = await locator.count();
        if (count === 0) {
          throw new Error(`Could not find controls matching "${command.text}".`);
        }

        if (requestedOccurrence === undefined && count > 1) {
          const preview: string[] = [];
          const previewLimit = Math.min(5, count);
          for (let i = 0; i < previewLimit; i += 1) {
            const candidate = locator.nth(i);
            const [innerTextRaw, ariaRaw] = await Promise.all([
              candidate.innerText().catch(() => ""),
              candidate.getAttribute("aria-label").catch(() => null)
            ]);
            const innerText = innerTextRaw.replace(/\s+/g, " ").trim();
            const aria = (ariaRaw ?? "").replace(/\s+/g, " ").trim();
            preview.push(`#${i + 1} text="${innerText || "-"}" aria="${aria || "-"}"`);
          }
          throw new Error(
            `Ambiguous clickByText "${command.text}" matched ${count} controls. ` +
            "Provide occurrence to disambiguate. " +
            `Candidates: ${preview.join("; ")}`
          );
        }

        if (count < occurrence) {
          throw new Error(
            `Could not find match #${occurrence} for "${command.text}". Found ${count} matching controls.`
          );
        }

        const target = locator.nth(occurrence - 1);
        await target.waitFor({ state: "visible", timeout: timeoutMs });
        await target.click({ timeout: timeoutMs });

        const matchedText = (await target.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return {
          type: command.type,
          ok: true,
          data: {
            matchedText,
            occurrence,
            totalMatches: count,
            stateAfter
          }
        };
      }
      case "type": {
        if (command.clear) {
          await page.fill(command.selector, command.text);
        } else {
          await page.locator(command.selector).type(command.text);
        }
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return { type: command.type, ok: true, data: stateAfter ? { stateAfter } : undefined };
      }
      case "typeIntoPrompt": {
        const timeoutMs = command.timeoutMs ?? 15_000;
        const promptTarget = await this.resolvePromptTarget(page);
        if (!promptTarget) {
          throw new Error("No visible textbox-like controls found for typeIntoPrompt.");
        }
        await promptTarget.locator.click({ timeout: timeoutMs });
        if (command.clear !== false) {
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
        }
        await promptTarget.locator.type(command.text, { timeout: timeoutMs });

        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return {
          type: command.type,
          ok: true,
          data: {
            candidateCount: promptTarget.count,
            chosenIndex: promptTarget.index,
            chosenMeta: promptTarget.meta,
            chosenScore: promptTarget.score,
            stateAfter
          }
        };
      }
      case "submitPrompt": {
        const timeoutMs = command.timeoutMs ?? 15_000;
        const promptTarget = await this.resolvePromptTarget(page);
        const promptCenter =
          promptTarget?.box
            ? {
              x: promptTarget.box.x + promptTarget.box.width / 2,
              y: promptTarget.box.y + promptTarget.box.height / 2
            }
            : null;

        const buttons = page.locator("button:visible, [role='button']:visible");
        const total = await buttons.count();
        if (total === 0) {
          throw new Error("No visible button-like controls found for submitPrompt.");
        }

        let chosenIndex = -1;
        let chosenText = "";
        let chosenScore = Number.NEGATIVE_INFINITY;

        for (let i = 0; i < total; i += 1) {
          const button = buttons.nth(i);
          const [innerTextRaw, ariaRaw, box] = await Promise.all([
            button.innerText().catch(() => ""),
            button.getAttribute("aria-label").catch(() => null),
            button.boundingBox().catch(() => null)
          ]);
          const innerText = innerTextRaw.replace(/\s+/g, " ").trim();
          const aria = (ariaRaw ?? "").replace(/\s+/g, " ").trim();
          const search = `${innerText} ${aria}`.toLowerCase();

          if (!["create", "generate", "submit", "run", "send"].some((keyword) => search.includes(keyword))) {
            continue;
          }

          let score = 0;
          if (search.includes("create")) {
            score += 30_000;
          }
          if (search.includes("generate")) {
            score += 30_000;
          }
          if (promptCenter && box) {
            const cx = box.x + box.width / 2;
            const cy = box.y + box.height / 2;
            const dx = cx - promptCenter.x;
            const dy = cy - promptCenter.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            score += Math.max(0, 20_000 - distance * 10);
          }

          if (score > chosenScore) {
            chosenScore = score;
            chosenIndex = i;
            chosenText = innerText || aria;
          }
        }

        if (chosenIndex < 0) {
          throw new Error("No visible submit-like controls matched create/generate keywords.");
        }

        await buttons.nth(chosenIndex).click({ timeout: timeoutMs });
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return {
          type: command.type,
          ok: true,
          data: {
            totalButtonsScanned: total,
            chosenIndex,
            chosenText,
            chosenScore,
            stateAfter
          }
        };
      }
      case "press": {
        await page.keyboard.press(command.key);
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return { type: command.type, ok: true, data: stateAfter ? { stateAfter } : undefined };
      }
      case "extractText": {
        const text = await page.locator(command.selector).first().innerText();
        return { type: command.type, ok: true, data: { text } };
      }
      case "getPageState": {
        const state = await this.captureStateAfterAction(page, {
          includeTextExcerpt: command.includeTextExcerpt ?? false,
          includeControlSummary: command.includeControlSummary ?? true,
          maxControls: command.maxControls ?? 80,
          maxTextChars: command.maxTextChars ?? 4000
        });
        const html = command.includeHtml ? await page.content() : undefined;

        return {
          type: command.type,
          ok: true,
          data: {
            ...state,
            html,
          }
        };
      }
      case "snapshot": {
        const session = this.sessions.get(profile.id);
        const elements: Array<{
          ref: string;
          selector: string;
          tag: string;
          role?: string;
          text?: string;
          ariaLabel?: string;
          placeholder?: string;
          playwrightHint?: string;
          domPath?: string;
        }> = [];
        if (session) {
          session.elementRefs.clear();
        }
        const snapshotCapture = await this.captureRefSnapshot(page, command.maxElements ?? 120);
        if (session) {
          session.lastSnapshotId = snapshotCapture.snapshotId;
        }
        for (const row of snapshotCapture.rows) {
          const ref = this.validateSnapshotRef(row.ref);
          const selector = this.buildDataRefSelector(ref);
          if (session) {
            session.elementRefs.set(ref, {
              ...row,
              ref,
              selector
            });
          }
          elements.push({
            ref,
            selector,
            tag: row.tag,
            role: row.role,
            text: row.text,
            ariaLabel: row.ariaLabel,
            placeholder: row.placeholder,
            playwrightHint: selector
          });
        }

        const url = page.url();
        const title = await page.title();

        return {
          type: command.type,
          ok: true,
          data: {
            url,
            title,
            elements,
            elementCount: elements.length,
            snapshotId: snapshotCapture.snapshotId,
            backend: snapshotCapture.backend
          }
        };
      }
      case "clickRef": {
        const session = this.sessions.get(profile.id);
        if (session && command.snapshotId && command.strictSnapshot && session.lastSnapshotId !== command.snapshotId) {
          throw new Error(
            `Snapshot mismatch for ref "${command.ref}". Expected ${command.snapshotId}, got ${session.lastSnapshotId ?? "none"}. Re-run snapshot.`
          );
        }

        const resolved = await this.resolveRefBinding(profile.id, page, command.ref, {
          allowRecovery: !command.strictSnapshot
        });
        const locator = page.locator(resolved.selector).first();
        await locator.click({ timeout: command.timeoutMs ?? 10_000 });
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return {
          type: command.type,
          ok: true,
          data: {
            ref: command.ref,
            selector: resolved.selector,
            matchCount: 1,
            recoveredFromStaleRef: resolved.recoveredFromStaleRef,
            snapshotId: session?.lastSnapshotId ?? null,
            backend: "playwright",
            stateAfter
          }
        };
      }
      case "typeRef": {
        const session = this.sessions.get(profile.id);
        if (session && command.snapshotId && command.strictSnapshot && session.lastSnapshotId !== command.snapshotId) {
          throw new Error(
            `Snapshot mismatch for ref "${command.ref}". Expected ${command.snapshotId}, got ${session.lastSnapshotId ?? "none"}. Re-run snapshot.`
          );
        }

        const resolved = await this.resolveRefBinding(profile.id, page, command.ref, {
          allowRecovery: !command.strictSnapshot
        });
        const target = page.locator(resolved.selector).first();
        await target.waitFor({ state: "visible", timeout: command.timeoutMs ?? 10_000 });
        await target.click({ timeout: command.timeoutMs ?? 10_000 });
        if (command.clear !== false) {
          await page.keyboard.press("Control+A");
          await page.keyboard.press("Backspace");
        }
        await target.type(command.text, { timeout: command.timeoutMs ?? 10_000 });
        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
        return {
          type: command.type,
          ok: true,
          data: {
            ref: command.ref,
            selector: resolved.selector,
            matchCount: 1,
            recoveredFromStaleRef: resolved.recoveredFromStaleRef,
            snapshotId: session?.lastSnapshotId ?? null,
            backend: "playwright",
            stateAfter
          }
        };
      }
      case "waitForText": {
        const timeoutMs = command.timeoutMs ?? 30_000;
        const polling = command.pollMs ?? 250;

        if (command.text) {
          await page.waitForFunction(
            (needle) => (document.body?.innerText ?? "").includes(needle),
            command.text,
            { timeout: timeoutMs, polling }
          );
        }
        if (command.textGone) {
          await page.waitForFunction(
            (needle) => !(document.body?.innerText ?? "").includes(needle),
            command.textGone,
            { timeout: timeoutMs, polling }
          );
        }

        const stateAfter =
          command.includeStateAfter === false
            ? undefined
            : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });

        return {
          type: command.type,
          ok: true,
          data: {
            matchedText: command.text,
            matchedTextGone: command.textGone,
            stateAfter
          }
        };
      }
      case "waitForDomState": {
        const timeoutMs = command.timeoutMs ?? 30_000;
        const pollMs = command.pollMs ?? 250;
        const stableForMs = command.stableForMs ?? 0;
        const anyVisibleSelectors = command.anyVisibleSelectors ?? [];
        const allHiddenSelectors = command.allHiddenSelectors ?? [];
        const checkDomSignal = async (): Promise<boolean> => {
          if (anyVisibleSelectors.length > 0) {
            const anyVisible = await Promise.all(
              anyVisibleSelectors.map((sel) => page.locator(sel).filter({ visible: true }).count())
            );
            if (!anyVisible.some((n) => n > 0)) return false;
          }
          if (allHiddenSelectors.length > 0) {
            const allHidden = await Promise.all(
              allHiddenSelectors.map((sel) => page.locator(sel).filter({ visible: true }).count())
            );
            if (!allHidden.every((n) => n === 0)) return false;
          }
          return true;
        };

        const startTime = Date.now();
        let stableStartedAt: number | null = null;

        while (Date.now() - startTime <= timeoutMs) {
          const matched = await checkDomSignal();

          if (matched) {
            if (stableStartedAt === null) {
              stableStartedAt = Date.now();
            }
            if (Date.now() - stableStartedAt >= stableForMs) {
              const stateAfter =
                command.includeStateAfter === false
                  ? undefined
                  : await this.captureStateAfterAction(page, { includeTextExcerpt: true, includeControlSummary: true });
              return {
                type: command.type,
                ok: true,
                data: {
                  anyVisibleSelectors,
                  allHiddenSelectors,
                  stableForMs,
                  stateAfter
                }
              };
            }
          } else {
            stableStartedAt = null;
          }

          await page.waitForTimeout(pollMs);
        }

        throw new Error(
          `waitForDomState timeout after ${timeoutMs}ms (anyVisibleSelectors=${anyVisibleSelectors.length}, allHiddenSelectors=${allHiddenSelectors.length}).`
        );
      }
      case "screenshot": {
        const fileName = this.resolveScreenshotPath(profile.id, command.path);
        await page.screenshot({ path: fileName, fullPage: command.fullPage ?? false });
        return {
          type: command.type,
          ok: true,
          data: {
            path: fileName,
            tabIndex: command.tabIndex
          }
        };
      }
      case "evaluate": {
        if (!this.allowEvaluate) {
          throw new Error("evaluate command is disabled. Set ALLOW_EVALUATE=true to enable it.");
        }
        const result = await page.evaluate(command.expression);
        return { type: command.type, ok: true, data: result };
      }
      case "getElementBounds": {
        const locator = page.locator(command.selector).first();
        await locator.waitFor({ state: "visible", timeout: command.timeoutMs ?? 10_000 });
        const box = await locator.boundingBox();
        if (!box) {
          throw new Error(`Element "${command.selector}" has no bounding box (may be hidden or detached).`);
        }
        return {
          type: command.type,
          ok: true,
          data: {
            selector: command.selector,
            x: box.x,
            y: box.y,
            width: box.width,
            height: box.height
          }
        };
      }
      case "screenshotElement": {
        const locator = page.locator(command.selector).first();
        await locator.waitFor({ state: "visible", timeout: command.timeoutMs ?? 10_000 });
        const fileName = this.resolveScreenshotPath(profile.id, command.path);
        await locator.screenshot({ path: fileName });
        return {
          type: command.type,
          ok: true,
          data: { path: fileName, selector: command.selector }
        };
      }
      case "screenshotRegion": {
        const fileName = this.resolveScreenshotPath(profile.id, command.path);
        await page.screenshot({
          path: fileName,
          clip: { x: command.x, y: command.y, width: command.width, height: command.height }
        });
        return {
          type: command.type,
          ok: true,
          data: {
            path: fileName,
            region: { x: command.x, y: command.y, width: command.width, height: command.height }
          }
        };
      }
      case "getCanvasPixels": {
        if (!this.allowEvaluate) {
          throw new Error("getCanvasPixels requires ALLOW_EVALUATE=true.");
        }
        const locator = page.locator(command.selector).first();
        await locator.waitFor({ state: "attached", timeout: command.timeoutMs ?? 10_000 });
        const result = await page.evaluate(
          ({ selector, downsampleTo, nonTransparentOnly, format }) => {
            const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
            if (!canvas) {
              return { error: `No canvas found for selector: ${selector}` };
            }
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              return { error: `Canvas has no 2d context (may be WebGL): ${selector}` };
            }
            const w = canvas.width;
            const h = canvas.height;
            const targetW = downsampleTo ? Math.min(downsampleTo, w) : w;
            const targetH = downsampleTo ? Math.min(downsampleTo, h) : h;
            const scaleX = w / targetW;
            const scaleY = h / targetH;
            const data = ctx.getImageData(0, 0, w, h).data;
            const toHex = (r: number, g: number, b: number, a: number) =>
              a === 0 ? "transparent" :
                "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("") +
                (a < 255 ? a.toString(16).padStart(2, "0") : "");
            const getPixel = (px: number, py: number) => {
              const i = (Math.round(py) * w + Math.round(px)) * 4;
              return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
            };
            if (format === "grid") {
              const grid: string[][] = [];
              for (let row = 0; row < targetH; row++) {
                const rowArr: string[] = [];
                for (let col = 0; col < targetW; col++) {
                  const { r, g, b, a } = getPixel(col * scaleX, row * scaleY);
                  if (nonTransparentOnly !== false && a === 0) { rowArr.push("transparent"); continue; }
                  rowArr.push(toHex(r, g, b, a));
                }
                grid.push(rowArr);
              }
              return { canvasWidth: w, canvasHeight: h, targetWidth: targetW, targetHeight: targetH, format: "grid", grid };
            } else {
              const pixels: Array<{ x: number; y: number; hex: string }> = [];
              for (let row = 0; row < targetH; row++) {
                for (let col = 0; col < targetW; col++) {
                  const { r, g, b, a } = getPixel(col * scaleX, row * scaleY);
                  if ((nonTransparentOnly !== false) && a === 0) continue;
                  pixels.push({ x: col, y: row, hex: toHex(r, g, b, a) });
                }
              }
              return { canvasWidth: w, canvasHeight: h, targetWidth: targetW, targetHeight: targetH, format: "sparse", pixelCount: pixels.length, pixels };
            }
          },
          {
            selector: command.selector,
            downsampleTo: command.downsampleTo,
            nonTransparentOnly: command.nonTransparentOnly,
            format: command.format ?? "sparse"
          }
        );
        if (result && "error" in result) {
          throw new Error(result.error);
        }
        return { type: command.type, ok: true, data: result };
      }
      default: {
        const unreachable: never = command;
        throw new Error(`Unsupported command ${(unreachable as { type?: string }).type ?? "unknown"}`);
      }
    }
  }

  private async resolveRefBinding(
    profileId: string,
    page: Page,
    ref: string,
    options?: {
      allowRecovery?: boolean;
    }
  ): Promise<{ selector: string; recoveredFromStaleRef: boolean }> {
    const session = this.sessions.get(profileId);
    const binding = session?.elementRefs.get(ref);
    if (!session || !binding) {
      throw new Error(`Unknown ref "${ref}". Run snapshot first.`);
    }

    let selector = binding.selector;
    let matchCount = await page.locator(selector).count();
    if (matchCount === 1) {
      return { selector, recoveredFromStaleRef: false };
    }

    const allowRecovery = options?.allowRecovery ?? true;
    if (allowRecovery) {
      const recoveredBinding = await this.tryRecoverRefBinding(page, binding);
      if (recoveredBinding) {
        selector = recoveredBinding.selector;
        matchCount = await page.locator(selector).count();
        if (matchCount === 1) {
          session.elementRefs.set(ref, recoveredBinding);
          return { selector, recoveredFromStaleRef: true };
        }
      }
    }

    throw new Error(
      `Ref "${ref}" resolved to ${matchCount} elements. Snapshot may be stale or ambiguous; run snapshot again.`
    );
  }

  private async tryRecoverRefBinding(page: Page, binding: ElementRefBinding): Promise<ElementRefBinding | null> {
    const snapshot = await this.captureRefSnapshot(page, 180);
    const best = this.findBestRefRecovery(snapshot.rows, binding);
    if (!best) {
      return null;
    }

    const ref = this.validateSnapshotRef(best.ref);
    return {
      ...best,
      ref,
      selector: this.buildDataRefSelector(ref)
    };
  }

  private findBestRefRecovery(
    rows: ElementRefSnapshotRow[],
    binding: ElementRefBinding
  ): ElementRefSnapshotRow | null {
    type Candidate = { row: ElementRefSnapshotRow; score: number };
    const scored: Candidate[] = [];
    for (const row of rows) {
      const score = this.scoreRefRecoveryCandidate(row, binding);
      if (score > 0) {
        scored.push({ row, score });
      }
    }
    if (scored.length === 0) {
      return null;
    }

    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (!best) {
      return null;
    }
    const second = scored[1];
    const secondScore = second?.score ?? 0;
    const safeMinimumScore = 8;
    const safeMargin = 2;
    if (best.score < safeMinimumScore || best.score - secondScore < safeMargin) {
      return null;
    }
    return best.row;
  }

  private scoreRefRecoveryCandidate(row: ElementRefSnapshotRow, binding: ElementRefBinding): number {
    let score = 0;

    if (row.tag === binding.tag) {
      score += 4;
    } else if (binding.tag) {
      score -= 2;
    }

    if (row.role && binding.role) {
      if (row.role === binding.role) {
        score += 3;
      } else {
        score -= 1;
      }
    }

    const rowAria = this.normalizeRefToken(row.ariaLabel);
    const bindAria = this.normalizeRefToken(binding.ariaLabel);
    if (rowAria && bindAria) {
      if (rowAria === bindAria) {
        score += 7;
      } else if (rowAria.includes(bindAria) || bindAria.includes(rowAria)) {
        score += 3;
      }
    }

    const rowPlaceholder = this.normalizeRefToken(row.placeholder);
    const bindPlaceholder = this.normalizeRefToken(binding.placeholder);
    if (rowPlaceholder && bindPlaceholder) {
      if (rowPlaceholder === bindPlaceholder) {
        score += 5;
      } else if (rowPlaceholder.includes(bindPlaceholder) || bindPlaceholder.includes(rowPlaceholder)) {
        score += 2;
      }
    }

    const rowText = this.normalizeRefToken(row.text);
    const bindText = this.normalizeRefToken(binding.text);
    if (rowText && bindText) {
      if (rowText === bindText) {
        score += 6;
      } else if (rowText.includes(bindText) || bindText.includes(rowText)) {
        score += 2;
      }
    }

    return score;
  }

  private normalizeRefToken(value?: string): string {
    if (!value) {
      return "";
    }
    return value.replace(/\s+/g, " ").trim().toLowerCase();
  }

  private validateSnapshotRef(ref: unknown): string {
    if (typeof ref !== "string") {
      throw new Error("Snapshot row ref must be a string.");
    }
    const normalized = ref.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(normalized)) {
      throw new Error(`Snapshot row ref contains unsupported characters: "${normalized}"`);
    }
    return normalized;
  }

  private buildDataRefSelector(ref: string): string {
    const normalized = this.validateSnapshotRef(ref);
    return `[data-codex-ref="${normalized}"]`;
  }

  private async captureStateAfterAction(
    page: Page,
    options: {
      includeTextExcerpt: boolean;
      includeControlSummary: boolean;
      maxControls?: number;
      maxTextChars?: number;
    }
  ): Promise<{
    url: string;
    title: string;
    textExcerpt?: string;
    controlSummary?: PageControlSummary;
  }> {
    const textLimit = options.maxTextChars ?? 1200;
    const controlLimit = options.maxControls ?? 30;

    const [title, url, textExcerpt, controlSummary] = await Promise.all([
      page.title(),
      Promise.resolve(page.url()),
      options.includeTextExcerpt
        ? page.evaluate((maxChars) => (document.body?.innerText ?? "").slice(0, maxChars), textLimit)
        : Promise.resolve(undefined),
      options.includeControlSummary ? this.collectControlSummary(page, controlLimit) : Promise.resolve(undefined)
    ]);

    return {
      url,
      title,
      textExcerpt,
      controlSummary
    };
  }

  private async resolveMouseOrigin(
    page: Page,
    command: CoordinateMouseCommand,
    timeoutMs: number
  ): Promise<ResolvedMouseOrigin> {
    const origin = command.origin ?? "viewport";
    if (origin !== "element") {
      return { origin: "viewport" };
    }

    const selector = command.selector?.trim();
    if (!selector) {
      throw new Error(`${command.type} requires selector when origin is element.`);
    }

    const locator = page.locator(selector).first();
    try {
      await locator.waitFor({ state: "visible", timeout: timeoutMs });
      await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not resolve element-relative origin for selector "${selector}" within ${timeoutMs}ms. ${message}`
      );
    }

    const box = await locator.boundingBox().catch(() => null);
    if (!box || box.width <= 0 || box.height <= 0) {
      throw new Error(`Selector "${selector}" is visible but has no usable bounding box for mouse coordinates.`);
    }

    return {
      origin: "element",
      selector,
      elementBox: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height
      }
    };
  }

  private resolveMousePoint(point: MousePoint, origin: ResolvedMouseOrigin): ResolvedMousePoint {
    const offsetX = origin.elementBox?.x ?? 0;
    const offsetY = origin.elementBox?.y ?? 0;
    return {
      input: {
        x: point.x,
        y: point.y
      },
      resolved: {
        x: offsetX + point.x,
        y: offsetY + point.y
      }
    };
  }

  private estimateMouseMoveSteps(from: MousePoint, to: MousePoint): number {
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    return Math.max(1, Math.min(100, Math.ceil(distance / 12)));
  }

  private async collectControlSummary(page: Page, maxControls: number): Promise<PageControlSummary> {
    const limit = Math.max(1, Math.min(200, Math.floor(maxControls)));
    const expression = `(() => {
      const selectors = [
        "button",
        "a[href]",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='textbox']",
        "[contenteditable='true']"
      ];
      const keywords = ["generate", "create", "submit", "send", "new project", "continue", "next", "done"];
      const controls = [];
      const seen = new Set();
      const duplicateCounter = {};
      const candidates = Array.from(document.querySelectorAll(selectors.join(",")));
      const buildDomPath = (element) => {
        const parts = [];
        let current = element;
        let depth = 0;
        while (current && current.nodeType === 1 && depth < 8) {
          const tag = current.tagName.toLowerCase();
          let index = 1;
          let sibling = current.previousElementSibling;
          while (sibling) {
            if (sibling.tagName.toLowerCase() === tag) {
              index += 1;
            }
            sibling = sibling.previousElementSibling;
          }
          parts.unshift(tag + ":nth-of-type(" + index + ")");
          current = current.parentElement;
          depth += 1;
        }
        return parts.join(" > ");
      };

      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        const element = candidate;
        const tag = candidate.tagName.toLowerCase();
        const textRaw = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        const text = textRaw.length > 0 ? textRaw : undefined;
        const ariaRaw = (element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
        const ariaLabel = ariaRaw.length > 0 ? ariaRaw : undefined;
        const placeholderRaw =
          candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement
            ? (candidate.placeholder || "").replace(/\\s+/g, " ").trim()
            : "";
        const placeholder = placeholderRaw.length > 0 ? placeholderRaw : undefined;
        const nameRaw =
          candidate instanceof HTMLInputElement ||
          candidate instanceof HTMLTextAreaElement ||
          candidate instanceof HTMLSelectElement
            ? (candidate.name || "").replace(/\\s+/g, " ").trim()
            : "";
        const name = nameRaw.length > 0 ? nameRaw : undefined;
        const typeRaw =
          candidate instanceof HTMLInputElement
            ? (candidate.type || "").replace(/\\s+/g, " ").trim()
            : "";
        const type = typeRaw.length > 0 ? typeRaw : undefined;
        const idRaw = (element.id || "").replace(/\\s+/g, " ").trim();
        const id = idRaw.length > 0 ? idRaw : undefined;
        const roleRaw = (element.getAttribute("role") || "").replace(/\\s+/g, " ").trim();
        const role = roleRaw.length > 0 ? roleRaw : undefined;
        const testIdRaw =
          (element.getAttribute("data-testid") ||
            element.getAttribute("data-test-id") ||
            element.getAttribute("data-qa") ||
            "").replace(/\\s+/g, " ").trim();
        const testId = testIdRaw.length > 0 ? testIdRaw : undefined;

        const key = [tag, text || "", ariaLabel || "", placeholder || "", name || "", buildDomPath(element)].join("|");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);

        const domPath = buildDomPath(element);
        let selectorHint;
        if (testId) {
          selectorHint = '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
        } else if (id) {
          selectorHint = "#" + id;
        } else if (ariaLabel) {
          selectorHint = tag + '[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]';
        } else if (role) {
          selectorHint = tag + '[role="' + role.replace(/"/g, '\\\\"') + '"]';
        } else if (placeholder && (tag === "input" || tag === "textarea")) {
          selectorHint = tag + '[placeholder="' + placeholder.replace(/"/g, '\\\\"') + '"]';
        } else if (text && (tag === "button" || tag === "a")) {
          selectorHint = tag + ':has-text("' + text.slice(0, 80).replace(/"/g, '\\\\"') + '")';
        }
        if (!selectorHint && domPath) {
          selectorHint = domPath;
        }

        const duplicateKey = (tag + "|" + (text || "") + "|" + (ariaLabel || "")).toLowerCase();
        const occurrence = (duplicateCounter[duplicateKey] || 0) + 1;
        duplicateCounter[duplicateKey] = occurrence;
        const playwrightHint =
          selectorHint && occurrence > 1
            ? ':nth-match(' + selectorHint + ', ' + occurrence + ')'
            : selectorHint;

        controls.push({
          index: controls.length,
          tag,
          role,
          type,
          text,
          ariaLabel,
          placeholder,
          name,
          id,
          testId,
          selectorHint,
          playwrightHint,
          occurrence,
          domPath
        });

        if (controls.length >= ${limit}) {
          break;
        }
      }

      const primaryActions = controls
        .filter((item) => {
          const search = ((item.text || "") + " " + (item.ariaLabel || "") + " " + (item.placeholder || "")).toLowerCase();
          return keywords.some((keyword) => search.includes(keyword));
        })
        .slice(0, 12)
        .map((item) => ({
          index: item.index,
          reason: "keyword-match",
          selectorHint: item.playwrightHint || item.selectorHint
        }));

      const suggestedTargets = [];
      const promptInput = controls.find((item) => {
        const tag = item.tag || "";
        const role = (item.role || "").toLowerCase();
        if (role === "textbox") {
          return true;
        }
        if (tag === "textarea") {
          return true;
        }
        if (tag === "input" && (!item.type || ["text", "search", "url", "email"].includes((item.type || "").toLowerCase()))) {
          return true;
        }
        return false;
      });
      if (promptInput) {
        suggestedTargets.push({
          purpose: "prompt-input",
          controlIndex: promptInput.index,
          selectorHint: promptInput.playwrightHint || promptInput.selectorHint,
          reason: "Detected editable textbox-like control"
        });
      }

      const submitAction = controls.find((item) => {
        const search = ((item.text || "") + " " + (item.ariaLabel || "")).toLowerCase();
        return ["create", "generate", "submit", "send"].some((keyword) => search.includes(keyword));
      });
      if (submitAction) {
        suggestedTargets.push({
          purpose: "submit-action",
          controlIndex: submitAction.index,
          selectorHint: submitAction.playwrightHint || submitAction.selectorHint,
          reason: "Detected likely submit/generate action"
        });
      }

      const projectEntry = controls.find((item) => {
        const search = ((item.text || "") + " " + (item.ariaLabel || "")).toLowerCase();
        return search.includes("edit project") || search.includes("project");
      });
      if (projectEntry) {
        suggestedTargets.push({
          purpose: "project-entry",
          controlIndex: projectEntry.index,
          selectorHint: projectEntry.playwrightHint || projectEntry.selectorHint,
          reason: "Detected likely project row/action"
        });
      }

      const bodyText = (document.body?.innerText || "").slice(0, 4000);
      const percentMatches = Array.from(bodyText.matchAll(/\\b\\d{1,3}%\\b/g)).map((match) => match[0]);
      const lower = bodyText.toLowerCase();
      const statusWords = ["generating", "rendering", "queued", "complete", "completed", "failed", "error"].filter(
        (word) => lower.includes(word)
      );
      const progressSignals = Array.from(new Set([...percentMatches, ...statusWords])).slice(0, 20);

      return { controls, primaryActions, progressSignals, suggestedTargets };
    })()`;

    const result = await page.evaluate(expression);
    return result as PageControlSummary;
  }

  private async captureRefSnapshot(
    page: Page,
    maxElements: number
  ): Promise<RefSnapshotCapture> {
    const limit = Math.max(1, Math.min(500, Math.floor(maxElements)));
    if (!this.enableSnapshotCache) {
      return await this.captureRefSnapshotFallback(page, limit);
    }

    try {
      const helperNonce = this.getOrCreateSnapshotHelperNonce(page);
      await this.ensureSnapshotCacheInitialized(page);

      const accelerated = await page.evaluate((payload: { requestedLimit: number; expectedNonce: string }) => {
        const { requestedLimit, expectedNonce } = payload;
        const helper = (window as unknown as {
          __codexRefSnapshotCacheHelper?: {
            __codexManaged?: boolean;
            __codexNonce?: string;
            capture: (limit: number) => { rows: unknown[]; snapshotId: string };
          };
        }).__codexRefSnapshotCacheHelper;
        if (
          !helper ||
          helper.__codexManaged !== true ||
          typeof helper.__codexNonce !== "string" ||
          helper.__codexNonce !== expectedNonce
        ) {
          return null;
        }
        return helper.capture(requestedLimit);
      }, {
        requestedLimit: limit,
        expectedNonce: helperNonce
      });
      if (!accelerated) {
        return await this.captureRefSnapshotFallback(page, limit);
      }

      return {
        rows: accelerated.rows as ElementRefSnapshotRow[],
        snapshotId: String(accelerated.snapshotId ?? `snapshot-${Date.now()}`),
        backend: "accelerated-cache"
      };
    } catch {
      return await this.captureRefSnapshotFallback(page, limit);
    }
  }

  private getOrCreateSnapshotHelperNonce(page: Page): string {
    const existing = this.snapshotHelperNonceByPage.get(page);
    if (existing) {
      return existing;
    }
    const nonce = randomUUID();
    this.snapshotHelperNonceByPage.set(page, nonce);
    return nonce;
  }

  private async ensureSnapshotCacheInitialized(page: Page): Promise<void> {
    const helperNonce = this.getOrCreateSnapshotHelperNonce(page);
    if (this.initializedSnapshotCachePages.has(page)) {
      try {
        const hasHelper = await page.evaluate((expectedNonce: string) => {
          const helper = (window as unknown as {
            __codexRefSnapshotCacheHelper?: { __codexManaged?: boolean; __codexNonce?: string };
          }).__codexRefSnapshotCacheHelper;
          return Boolean(
            helper &&
              helper.__codexManaged === true &&
              typeof helper.__codexNonce === "string" &&
              helper.__codexNonce === expectedNonce
          );
        }, helperNonce);
        if (hasHelper) {
          return;
        }
      } catch {
        // ignore and re-initialize below
      }
    }

    await page.evaluate((expectedNonce: string) => {
      const existing = (window as unknown as {
        __codexRefSnapshotCacheHelper?: { __codexManaged?: boolean; __codexNonce?: string };
      }).__codexRefSnapshotCacheHelper;
      if (
        existing?.__codexManaged === true &&
        typeof existing.__codexNonce === "string" &&
        existing.__codexNonce === expectedNonce
      ) {
        return;
      }

      const selectors = [
        "button",
        "a[href]",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='textbox']",
        "[contenteditable='true']"
      ].join(",");

      const normalize = (value: string | null | undefined): string | undefined => {
        const normalized = (value ?? "").replace(/\s+/g, " ").trim();
        return normalized.length > 0 ? normalized : undefined;
      };

      const cache = {
        dirty: true,
        version: 0,
        nextRefId: 1,
        lastLimit: 0,
        snapshotSeq: 0,
        snapshotId: "snapshot-0",
        tracked: [] as Element[],
        rows: [] as Array<{
          ref: string;
          tag: string;
          role?: string;
          text?: string;
          ariaLabel?: string;
          placeholder?: string;
        }>,
        elementToRef: new WeakMap<Element, string>()
      };

      const markDirty = () => {
        cache.dirty = true;
        cache.version += 1;
      };

      if (document.documentElement) {
        const observer = new MutationObserver((records) => {
          const shouldIgnore = records.every((record) => {
            if (record.type !== "attributes") {
              return false;
            }
            return record.attributeName === "data-codex-ref";
          });
          if (!shouldIgnore) {
            markDirty();
          }
        });
        observer.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true
        });
      }

      window.addEventListener("hashchange", markDirty);
      window.addEventListener("popstate", markDirty);
      window.addEventListener("beforeunload", markDirty);

      const managedHelper = {
        __codexManaged: true,
        __codexNonce: expectedNonce,
        capture(limit: number) {
          const requestedLimit = Math.max(1, Math.min(500, Math.floor(limit)));
          const shouldRebuild = cache.dirty || cache.rows.length === 0 || cache.lastLimit < requestedLimit;
          if (shouldRebuild) {
            for (let i = 0; i < cache.tracked.length; i += 1) {
              cache.tracked[i]?.removeAttribute("data-codex-ref");
            }
            cache.tracked = [];
            cache.rows = [];
            cache.lastLimit = requestedLimit;

            const seen = new Set<Element>();
            const candidates = Array.from(document.querySelectorAll(selectors));
            for (let i = 0; i < candidates.length; i += 1) {
              const candidate = candidates[i];
              if (!candidate || seen.has(candidate)) {
                continue;
              }
              seen.add(candidate);

              const style = window.getComputedStyle(candidate);
              if (style.visibility === "hidden" || style.display === "none") {
                continue;
              }
              const rect = candidate.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) {
                continue;
              }

              let ref = cache.elementToRef.get(candidate);
              if (!ref) {
                ref = `e${cache.nextRefId}`;
                cache.nextRefId += 1;
                cache.elementToRef.set(candidate, ref);
              }

              candidate.setAttribute("data-codex-ref", ref);
              cache.tracked.push(candidate);

              const tag = candidate.tagName.toLowerCase();
              const text = normalize((candidate as HTMLElement).innerText ?? candidate.textContent);
              const ariaLabel = normalize(candidate.getAttribute("aria-label"));
              const role = normalize(candidate.getAttribute("role"));
              const placeholder =
                candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement
                  ? normalize(candidate.placeholder)
                  : undefined;

              cache.rows.push({ ref, tag, role, text, ariaLabel, placeholder });
              if (cache.rows.length >= requestedLimit) {
                break;
              }
            }

            cache.dirty = false;
            cache.snapshotSeq += 1;
            cache.snapshotId = `snapshot-${cache.version}-${cache.snapshotSeq}`;
          }

          return {
            rows: cache.rows.slice(0, requestedLimit),
            snapshotId: cache.snapshotId
          };
        }
      };
      Object.freeze(managedHelper);

      const globalWindow = window as unknown as {
        __codexRefSnapshotCacheHelper?: {
          __codexManaged?: boolean;
          __codexNonce?: string;
          capture: (limit: number) => { rows: unknown[]; snapshotId: string };
        };
      };

      try {
        Object.defineProperty(globalWindow, "__codexRefSnapshotCacheHelper", {
          value: managedHelper,
          configurable: false,
          enumerable: false,
          writable: false
        });
      } catch {
        // Fail closed: if we cannot lock down the helper property, skip accelerated helper install.
      }
    }, helperNonce);

    this.initializedSnapshotCachePages.add(page);
  }

  private async captureRefSnapshotFallback(page: Page, limit: number): Promise<RefSnapshotCapture> {
    const expression = `(() => {
      const selectors = [
        "button",
        "a[href]",
        "input",
        "textarea",
        "select",
        "[role='button']",
        "[role='textbox']",
        "[contenteditable='true']"
      ];

      const prev = Array.from(document.querySelectorAll("[data-codex-ref]"));
      for (let i = 0; i < prev.length; i += 1) {
        prev[i].removeAttribute("data-codex-ref");
      }

      const rows = [];
      const seenElements = new Set();
      const candidates = Array.from(document.querySelectorAll(selectors.join(",")));
      for (let i = 0; i < candidates.length; i += 1) {
        const candidate = candidates[i];
        if (seenElements.has(candidate)) {
          continue;
        }
        seenElements.add(candidate);

        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        if (style.visibility === "hidden" || style.display === "none" || rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        const ref = "e" + (rows.length + 1);
        candidate.setAttribute("data-codex-ref", ref);

        const element = candidate;
        const textRaw = (element.innerText || element.textContent || "").replace(/\\s+/g, " ").trim();
        const text = textRaw.length > 0 ? textRaw : undefined;
        const ariaRaw = (element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim();
        const ariaLabel = ariaRaw.length > 0 ? ariaRaw : undefined;
        const placeholderRaw =
          candidate instanceof HTMLInputElement || candidate instanceof HTMLTextAreaElement
            ? (candidate.placeholder || "").replace(/\\s+/g, " ").trim()
            : "";
        const placeholder = placeholderRaw.length > 0 ? placeholderRaw : undefined;
        const roleRaw = (element.getAttribute("role") || "").replace(/\\s+/g, " ").trim();
        const role = roleRaw.length > 0 ? roleRaw : undefined;
        const tag = candidate.tagName.toLowerCase();

        rows.push({ ref, tag, role, text, ariaLabel, placeholder });
        if (rows.length >= ${limit}) {
          break;
        }
      }

      return rows;
    })()`;

    const rows = (await page.evaluate(expression)) as ElementRefSnapshotRow[];
    return {
      rows,
      snapshotId: `snapshot-fallback-${Date.now()}`,
      backend: "playwright"
    };
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

  private invalidateElementRefs(session: SessionState): void {
    session.elementRefs.clear();
    session.lastSnapshotId = null;
  }

  private async resolvePromptTarget(page: Page): Promise<PromptTarget | null> {
    const candidates = page.locator(
      "[role='textbox']:visible, textarea:visible, [contenteditable='true']:visible, input[type='text']:visible, input:not([type]):visible"
    );
    const count = await candidates.count();
    if (count === 0) {
      return null;
    }

    let best: PromptTarget | null = null;
    for (let i = 0; i < count; i += 1) {
      const locator = candidates.nth(i);
      const [box, tag, role, ariaLabel, placeholder] = await Promise.all([
        locator.boundingBox().catch(() => null),
        locator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "unknown"),
        locator.getAttribute("role").catch(() => null),
        locator.getAttribute("aria-label").catch(() => null),
        locator.getAttribute("placeholder").catch(() => null)
      ]);

      const area = box ? Math.max(1, box.width * box.height) : 1;
      const meta = `${ariaLabel ?? ""} ${placeholder ?? ""}`.toLowerCase();

      let score = area;
      if ((role ?? "").toLowerCase() === "textbox") {
        score += 20_000;
      }
      if (tag === "textarea") {
        score += 15_000;
      }
      if (meta.includes("prompt") || meta.includes("describe") || meta.includes("what")) {
        score += 40_000;
      }
      if (meta.includes("title") || meta.includes("name")) {
        score -= 40_000;
      }

      if (!best || score > best.score) {
        best = {
          locator,
          index: i,
          count,
          meta,
          score,
          box
        };
      }
    }

    return best;
  }

  private resolveBrowserType(engine: ProfileRecord["engine"]): BrowserType {
    return engine === "firefox" ? firefox : chromium;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    const extensionArgs = await this.resolveAcceleratorExtensionArgs(profile);
    
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
      args: extensionArgs,
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

  private async resolveAcceleratorExtensionArgs(profile: ProfileRecord): Promise<string[] | undefined> {
    if (!this.enableAcceleratorExtension) {
      return undefined;
    }
    if (profile.engine === "firefox") {
      return undefined;
    }
    if (!this.acceleratorExtensionDir) {
      return undefined;
    }

    try {
      await access(this.acceleratorExtensionDir);
    } catch {
      if (!this.didLogMissingAcceleratorExtension) {
        this.didLogMissingAcceleratorExtension = true;
        console.warn(
          `Accelerator extension directory not found: ${this.acceleratorExtensionDir}. Continuing without extension.`
        );
      }
      return undefined;
    }

    // Chrome/Edge may ignore side-loaded extensions in some channels.
    // We still keep core acceleration via in-page cache, so this stays optional.
    return [
      `--disable-extensions-except=${this.acceleratorExtensionDir}`,
      `--load-extension=${this.acceleratorExtensionDir}`
    ];
  }

  private resolveScreenshotPath(profileId: string, inputPath: string | undefined): string {
    if (!inputPath) {
      return path.join(this.artifactsDir, `${profileId}-${Date.now()}.png`);
    }

    if (path.isAbsolute(inputPath)) {
      throw new Error("Absolute screenshot paths are not allowed.");
    }

    const artifactsRoot = path.resolve(this.artifactsDir);
    const resolved = path.resolve(artifactsRoot, inputPath);
    const relative = path.relative(artifactsRoot, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Screenshot path must stay inside the artifacts directory.");
    }

    return resolved;
  }

  private bindPageLifecycle(session: SessionState, page: Page): void {
    if (session.boundPages.has(page)) {
      return;
    }
    session.boundPages.add(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.invalidateElementRefs(session);
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
    this.invalidateElementRefs(session);
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
    this.invalidateElementRefs(session);
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
