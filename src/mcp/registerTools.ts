import { z } from "zod";
import {
  BackupProfileToolInputSchema,
  CaptureActiveScreenshotToolInputSchema,
  ClickActiveRefToolInputSchema,
  ClickActiveCanvasToolInputSchema,
  CreateProfileToolInputSchema,
  DragActiveCanvasToolInputSchema,
  DeleteArtifactToolInputSchema,
  EnsureBrowserProfileToolInputSchema,
  EnsureActiveProfileToolInputSchema,
  EnsureGeminiProfileToolInputSchema,
  GetActivePageStateToolInputSchema,
  ListBackupsToolInputSchema,
  OpenGeminiSessionToolInputSchema,
  OpenUrlSessionToolInputSchema,
  ProfileIdToolInputSchema,
  ReleaseActiveProfileToolInputSchema,
  RestoreProfileBackupToolInputSchema,
  RunActiveCommandsToolInputSchema,
  RunCommandsToolInputSchema,
  SelectActiveTabByUrlPrefixToolInputSchema,
  SetActiveProfileToolInputSchema,
  SnapshotActivePageToolInputSchema,
  ToolDescriptions,
  TypeActiveRefToolInputSchema,
  UpdateProfileToolInputSchema,
  WaitForActiveProgressToolInputBaseSchema,
  WaitForActiveProgressToolInputSchema,
  WaitForActiveTextToolInputBaseSchema,
  WaitForActiveTextToolInputSchema,
  PathActiveCanvasToolInputSchema,
  EnsurePiskelProfileToolInputSchema,
  DrawPiskelPatternToolInputSchema,
  ScreenshotActiveElementToolInputSchema,
  ScreenshotActiveRegionToolInputSchema,
  GetCanvasPixelsToolInputSchema
} from "./toolSchemas.js";
import type { BrowserCommand, CommandExecutionResult } from "../domain/commands.js";

export type ApiRequestFn = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface RegisterableMcpServer {
  registerTool(
    name: string,
    definition: {
      description: string;
      inputSchema: Record<string, z.ZodTypeAny>;
    },
    handler: (input: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>
  ): void;
}

export const toText = (value: unknown): { content: [{ type: "text"; text: string }] } => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
});

interface ControlStateResponse {
  activeProfileId: string | null;
}

interface ProfilesResponse {
  profiles: Array<{
    id: string;
    name: string;
    updatedAt: string;
  }>;
  runningProfileIds: string[];
}

interface EnsureActiveProfileDefaults {
  profileId?: string;
  profileName?: string;
  autoStart: boolean;
  setActive: boolean;
  preferRunningBrowserProfile: boolean;
  allowAnyRunningFallback: boolean;
}

interface CommandBatchResponse {
  total: number;
  successCount: number;
  results: CommandExecutionResult[];
}

interface CompactCommandResult {
  type: CommandExecutionResult["type"];
  ok: boolean;
  data?: unknown;
  error?: string;
}

interface TabInfo {
  index: number;
  url: string;
  title: string;
  active: boolean;
}

type CanvasWrapperOrigin = "viewport" | "selector" | undefined;

const isEnsureActiveRouteMissingError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("POST:/control/ensure-active") ||
    (message.includes("404") && message.includes("/control/ensure-active"))
  );
};

const ensureActiveProfileLegacyFallback = async (
  apiRequest: ApiRequestFn,
  payload: EnsureActiveProfileDefaults
): Promise<unknown> => {
  const [controlState, profilesPayload] = await Promise.all([
    apiRequest<ControlStateResponse>("/control/state"),
    apiRequest<ProfilesResponse>("/profiles")
  ]);
  const runningSet = new Set(profilesPayload.runningProfileIds ?? []);

  let profile = payload.profileId
    ? profilesPayload.profiles.find((candidate) => candidate.id === payload.profileId)
    : undefined;
  let resolvedFrom: string = payload.profileId ? "explicit-profile-id" : "none";

  if (!profile && payload.profileName) {
    profile = profilesPayload.profiles.find(
      (candidate) => candidate.name.toLowerCase() === payload.profileName?.trim().toLowerCase()
    );
    resolvedFrom = "explicit-profile-name";
  }

  if (!profile && controlState.activeProfileId) {
    profile = profilesPayload.profiles.find((candidate) => candidate.id === controlState.activeProfileId);
    resolvedFrom = "existing-active";
  }

  if (!profile && payload.preferRunningBrowserProfile) {
    profile =
      profilesPayload.profiles.find(
        (candidate) => candidate.name.toLowerCase() === "browser profile" && runningSet.has(candidate.id)
      ) ?? undefined;
    resolvedFrom = profile ? "running-browser-profile" : resolvedFrom;
  }

  if (!profile && payload.allowAnyRunningFallback) {
    profile = profilesPayload.profiles
      .filter((candidate) => runningSet.has(candidate.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    resolvedFrom = profile ? "any-running" : resolvedFrom;
  }

  if (!profile) {
    throw new Error(
      "No profile could be resolved. Provide profileId/profileName, or set allowAnyRunningFallback=true."
    );
  }

  const wasRunning = runningSet.has(profile.id);
  let started = false;
  if (payload.autoStart && !wasRunning) {
    await apiRequest(`/profiles/${profile.id}/start`, {
      method: "POST",
      body: JSON.stringify({ setActive: false })
    });
    started = true;
    runningSet.add(profile.id);
  }

  let activeProfileId = controlState.activeProfileId;
  if (payload.setActive) {
    const setActiveResponse = await apiRequest<{ activeProfileId: string | null; updatedAt: string }>(
      "/control/active-profile",
      {
        method: "POST",
        body: JSON.stringify({
          profileId: profile.id,
          autoStart: payload.autoStart
        })
      }
    );
    activeProfileId = setActiveResponse.activeProfileId;
  }

  return {
    profile,
    resolvedFrom,
    started,
    running: runningSet.has(profile.id),
    activeProfileId,
    compatibilityMode: "legacy-ensure-active-fallback"
  };
};

const runSingleActiveCommand = async (
  apiRequest: ApiRequestFn,
  command: BrowserCommand,
  autoStart: boolean
): Promise<{ command: CommandExecutionResult; batch: CommandBatchResponse }> => {
  const batch = await apiRequest<CommandBatchResponse>("/control/active/commands", {
    method: "POST",
    body: JSON.stringify({
      autoStart,
      commands: [command]
    })
  });

  const result = batch.results?.[0];
  if (!result) {
    throw new Error("Active command batch returned no results.");
  }
  if (!result.ok) {
    throw new Error(result.error ?? `Command ${result.type} failed on active profile.`);
  }

  return {
    command: result,
    batch
  };
};

const compactCommandResult = (result: CommandExecutionResult): CompactCommandResult => ({
  type: result.type,
  ok: result.ok,
  data: result.data,
  error: result.error
});

const formatSingleCommandOutput = (
  payload: { command: CommandExecutionResult; batch: CommandBatchResponse },
  compact: boolean,
  extra: Record<string, unknown> = {}
): unknown => {
  if (!compact) {
    return {
      ...payload,
      ...extra
    };
  }

  return {
    command: compactCommandResult(payload.command),
    ...extra
  };
};

const formatBatchOutput = (payload: CommandBatchResponse, compact: boolean): unknown => {
  if (!compact) {
    return payload;
  }

  return {
    total: payload.total,
    successCount: payload.successCount,
    failureCount: Math.max(0, payload.total - payload.successCount),
    results: payload.results.map((result) => ({
      type: result.type,
      ok: result.ok,
      error: result.error
    }))
  };
};

const toCanvasCommandOrigin = (origin: CanvasWrapperOrigin): "viewport" | "element" | undefined =>
  origin === "selector" ? "element" : origin;

export const registerBrowserTools = (server: RegisterableMcpServer, apiRequest: ApiRequestFn): void => {
  server.registerTool(
    "list_profiles",
    {
      description: ToolDescriptions.listProfiles,
      inputSchema: {}
    },
    async () => {
      const payload = await apiRequest("/profiles");
      return toText(payload);
    }
  );

  server.registerTool(
    "get_profile",
    {
      description: ToolDescriptions.getProfile,
      inputSchema: {
        profileId: z.string().uuid()
      }
    },
    async (input) => {
      const { profileId } = ProfileIdToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${profileId}`);
      return toText(payload);
    }
  );

  server.registerTool(
    "create_profile",
    {
      description: ToolDescriptions.createProfile,
      inputSchema: {
        name: z.string().min(1),
        engine: z.enum(["chrome", "msedge", "chromium", "firefox"]).optional(),
        userAgent: z.string().optional(),
        headless: z.boolean().optional(),
        externalDataDir: z.string().min(1).optional(),
        proxy: z
          .object({
            server: z.string().min(3),
            username: z.string().optional(),
            password: z.string().optional()
          })
          .optional()
      }
    },
    async (input) => {
      const parsed = CreateProfileToolInputSchema.parse(input);
      const payload = await apiRequest("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: parsed.name,
          engine: parsed.engine ?? "chrome",
          settings: {
            userAgent: parsed.userAgent,
            headless: parsed.headless,
            proxy: parsed.proxy
          },
          externalDataDir: parsed.externalDataDir
        })
      });

      return toText(payload);
    }
  );

  server.registerTool(
    "update_profile",
    {
      description: ToolDescriptions.updateProfile,
      inputSchema: {
        profileId: z.string().uuid(),
        name: z.string().optional(),
        engine: z.enum(["chrome", "msedge", "chromium", "firefox"]).optional(),
        userAgent: z.string().optional(),
        headless: z.boolean().optional(),
        externalDataDir: z.string().min(1).optional(),
        proxy: z
          .object({
            server: z.string().min(3),
            username: z.string().optional(),
            password: z.string().optional()
          })
          .optional()
      }
    },
    async (input) => {
      const parsed = UpdateProfileToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: parsed.name,
          engine: parsed.engine,
          settings: {
            userAgent: parsed.userAgent,
            headless: parsed.headless,
            proxy: parsed.proxy
          },
          externalDataDir: parsed.externalDataDir
        })
      });

      return toText(payload);
    }
  );

  server.registerTool(
    "ensure_gemini_profile",
    {
      description: ToolDescriptions.ensureGeminiProfile,
      inputSchema: {
        externalDataDir: z.string().min(1).optional(),
        forceUpdate: z.boolean().optional(),
        userAgent: z.string().optional()
      }
    },
    async (input) => {
      const parsed = EnsureGeminiProfileToolInputSchema.parse(input);
      const payload = await apiRequest("/profiles/ensure/gemini", {
        method: "POST",
        body: JSON.stringify({
          externalDataDir: parsed.externalDataDir,
          forceUpdate: parsed.forceUpdate ?? false,
          userAgent: parsed.userAgent
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "ensure_browser_profile",
    {
      description: ToolDescriptions.ensureBrowserProfile,
      inputSchema: {
        externalDataDir: z.string().min(1).optional(),
        forceUpdate: z.boolean().optional(),
        userAgent: z.string().optional()
      }
    },
    async (input) => {
      const parsed = EnsureBrowserProfileToolInputSchema.parse(input);
      const payload = await apiRequest("/profiles/ensure/browser", {
        method: "POST",
        body: JSON.stringify({
          externalDataDir: parsed.externalDataDir,
          forceUpdate: parsed.forceUpdate ?? false,
          userAgent: parsed.userAgent
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "open_gemini_session",
    {
      description: ToolDescriptions.openGeminiSession,
      inputSchema: {
        externalDataDir: z.string().min(1).optional(),
        forceUpdate: z.boolean().optional(),
        autoSetActive: z.boolean().optional(),
        targetUrl: z.string().url().optional()
      }
    },
    async (input) => {
      const parsed = OpenGeminiSessionToolInputSchema.parse(input);
      const payload = await apiRequest("/control/open-gemini", {
        method: "POST",
        body: JSON.stringify({
          externalDataDir: parsed.externalDataDir,
          forceUpdate: parsed.forceUpdate ?? true,
          autoSetActive: parsed.autoSetActive ?? true,
          targetUrl: parsed.targetUrl ?? "https://gemini.google.com/"
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "get_control_state",
    {
      description: ToolDescriptions.getControlState,
      inputSchema: {}
    },
    async () => {
      const payload = await apiRequest("/control/state");
      return toText(payload);
    }
  );

  server.registerTool(
    "ensure_active_profile",
    {
      description: ToolDescriptions.ensureActiveProfile,
      inputSchema: {
        profileId: z.string().uuid().optional(),
        profileName: z.string().min(1).max(200).optional(),
        autoStart: z.boolean().optional(),
        setActive: z.boolean().optional(),
        preferRunningBrowserProfile: z.boolean().optional(),
        allowAnyRunningFallback: z.boolean().optional()
      }
    },
    async (input) => {
      const parsed = EnsureActiveProfileToolInputSchema.parse(input ?? {});
      const normalized: EnsureActiveProfileDefaults = {
        profileId: parsed.profileId,
        profileName: parsed.profileName,
        autoStart: parsed.autoStart ?? true,
        setActive: parsed.setActive ?? true,
        preferRunningBrowserProfile: parsed.preferRunningBrowserProfile ?? true,
        allowAnyRunningFallback: parsed.allowAnyRunningFallback ?? false
      };
      try {
        const payload = await apiRequest("/control/ensure-active", {
          method: "POST",
          body: JSON.stringify(normalized)
        });
        return toText(payload);
      } catch (error) {
        if (!isEnsureActiveRouteMissingError(error)) {
          throw error;
        }
        const payload = await ensureActiveProfileLegacyFallback(apiRequest, normalized);
        return toText(payload);
      }
    }
  );

  server.registerTool(
    "set_active_profile",
    {
      description: ToolDescriptions.setActiveProfile,
      inputSchema: {
        profileId: z.string().uuid(),
        autoStart: z.boolean().optional()
      }
    },
    async (input) => {
      const parsed = SetActiveProfileToolInputSchema.parse(input);
      const payload = await apiRequest("/control/active-profile", {
        method: "POST",
        body: JSON.stringify({
          profileId: parsed.profileId,
          autoStart: parsed.autoStart ?? true
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "release_active_profile",
    {
      description: ToolDescriptions.releaseActiveProfile,
      inputSchema: {}
    },
    async (input) => {
      ReleaseActiveProfileToolInputSchema.parse(input ?? {});
      const payload = await apiRequest("/control/release", {
        method: "POST",
        body: JSON.stringify({})
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "open_url_session",
    {
      description: ToolDescriptions.openUrlSession,
      inputSchema: {
        url: z.string().url(),
        profileId: z.string().uuid().optional(),
        autoSetActive: z.boolean().optional(),
        autoStart: z.boolean().optional()
      }
    },
    async (input) => {
      const parsed = OpenUrlSessionToolInputSchema.parse(input);
      const payload = await apiRequest("/control/open-url", {
        method: "POST",
        body: JSON.stringify({
          url: parsed.url,
          profileId: parsed.profileId,
          autoSetActive: parsed.autoSetActive ?? true,
          autoStart: parsed.autoStart ?? true
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "run_active_commands",
    {
      description: ToolDescriptions.runActiveCommands,
      inputSchema: {
        autoStart: RunActiveCommandsToolInputSchema.shape.autoStart,
        compact: RunActiveCommandsToolInputSchema.shape.compact,
        commands: RunActiveCommandsToolInputSchema.shape.commands
      }
    },
    async (input) => {
      const parsed = RunActiveCommandsToolInputSchema.parse(input);
      const payload = await apiRequest<CommandBatchResponse>("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({
          autoStart: parsed.autoStart ?? true,
          commands: parsed.commands
        })
      });
      return toText(formatBatchOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "snapshot_active_page",
    {
      description: ToolDescriptions.snapshotActivePage,
      inputSchema: {
        maxElements: SnapshotActivePageToolInputSchema.shape.maxElements,
        autoStart: SnapshotActivePageToolInputSchema.shape.autoStart,
        compact: SnapshotActivePageToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = SnapshotActivePageToolInputSchema.parse(input ?? {});
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "snapshot",
          maxElements: parsed.maxElements
        },
        parsed.autoStart ?? true
      );
      return toText(
        formatSingleCommandOutput(payload, parsed.compact ?? false, {
          refLifecycle:
            "Refs are invalidated by navigation, tab switches, tab open/close, and major DOM rerenders. Re-run snapshot when interaction fails."
        })
      );
    }
  );

  server.registerTool(
    "click_active_ref",
    {
      description: ToolDescriptions.clickActiveRef,
      inputSchema: {
        ref: ClickActiveRefToolInputSchema.shape.ref,
        snapshotId: ClickActiveRefToolInputSchema.shape.snapshotId,
        strictSnapshot: ClickActiveRefToolInputSchema.shape.strictSnapshot,
        timeoutMs: ClickActiveRefToolInputSchema.shape.timeoutMs,
        includeStateAfter: ClickActiveRefToolInputSchema.shape.includeStateAfter,
        autoStart: ClickActiveRefToolInputSchema.shape.autoStart,
        compact: ClickActiveRefToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = ClickActiveRefToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "clickRef",
          ref: parsed.ref,
          snapshotId: parsed.snapshotId,
          strictSnapshot: parsed.strictSnapshot,
          timeoutMs: parsed.timeoutMs,
          includeStateAfter: parsed.includeStateAfter ?? false
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "type_active_ref",
    {
      description: ToolDescriptions.typeActiveRef,
      inputSchema: {
        ref: TypeActiveRefToolInputSchema.shape.ref,
        snapshotId: TypeActiveRefToolInputSchema.shape.snapshotId,
        strictSnapshot: TypeActiveRefToolInputSchema.shape.strictSnapshot,
        text: TypeActiveRefToolInputSchema.shape.text,
        clear: TypeActiveRefToolInputSchema.shape.clear,
        timeoutMs: TypeActiveRefToolInputSchema.shape.timeoutMs,
        includeStateAfter: TypeActiveRefToolInputSchema.shape.includeStateAfter,
        autoStart: TypeActiveRefToolInputSchema.shape.autoStart,
        compact: TypeActiveRefToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = TypeActiveRefToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "typeRef",
          ref: parsed.ref,
          snapshotId: parsed.snapshotId,
          strictSnapshot: parsed.strictSnapshot,
          text: parsed.text,
          clear: parsed.clear,
          timeoutMs: parsed.timeoutMs,
          includeStateAfter: parsed.includeStateAfter ?? false
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "click_active_canvas",
    {
      description: ToolDescriptions.clickActiveCanvas,
      inputSchema: {
        x: ClickActiveCanvasToolInputSchema.shape.x,
        y: ClickActiveCanvasToolInputSchema.shape.y,
        origin: ClickActiveCanvasToolInputSchema.shape.origin,
        selector: ClickActiveCanvasToolInputSchema.shape.selector,
        timeoutMs: ClickActiveCanvasToolInputSchema.shape.timeoutMs,
        includeStateAfter: ClickActiveCanvasToolInputSchema.shape.includeStateAfter,
        autoStart: ClickActiveCanvasToolInputSchema.shape.autoStart,
        compact: ClickActiveCanvasToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = ClickActiveCanvasToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "mouse",
          action: "click",
          coordinates: {
            x: parsed.x,
            y: parsed.y
          },
          origin: toCanvasCommandOrigin(parsed.origin),
          selector: parsed.selector,
          timeoutMs: parsed.timeoutMs,
          includeStateAfter: parsed.includeStateAfter
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "drag_active_canvas",
    {
      description: ToolDescriptions.dragActiveCanvas,
      inputSchema: {
        startX: DragActiveCanvasToolInputSchema.shape.startX,
        startY: DragActiveCanvasToolInputSchema.shape.startY,
        endX: DragActiveCanvasToolInputSchema.shape.endX,
        endY: DragActiveCanvasToolInputSchema.shape.endY,
        origin: DragActiveCanvasToolInputSchema.shape.origin,
        selector: DragActiveCanvasToolInputSchema.shape.selector,
        timeoutMs: DragActiveCanvasToolInputSchema.shape.timeoutMs,
        includeStateAfter: DragActiveCanvasToolInputSchema.shape.includeStateAfter,
        autoStart: DragActiveCanvasToolInputSchema.shape.autoStart,
        compact: DragActiveCanvasToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = DragActiveCanvasToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "mouseDrag",
          from: {
            x: parsed.startX,
            y: parsed.startY
          },
          to: {
            x: parsed.endX,
            y: parsed.endY
          },
          origin: toCanvasCommandOrigin(parsed.origin),
          selector: parsed.selector,
          timeoutMs: parsed.timeoutMs,
          includeStateAfter: parsed.includeStateAfter
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "path_active_canvas",
    {
      description: ToolDescriptions.pathActiveCanvas,
      inputSchema: {
        points: PathActiveCanvasToolInputSchema.shape.points,
        origin: PathActiveCanvasToolInputSchema.shape.origin,
        selector: PathActiveCanvasToolInputSchema.shape.selector,
        timeoutMs: PathActiveCanvasToolInputSchema.shape.timeoutMs,
        includeStateAfter: PathActiveCanvasToolInputSchema.shape.includeStateAfter,
        autoStart: PathActiveCanvasToolInputSchema.shape.autoStart,
        compact: PathActiveCanvasToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = PathActiveCanvasToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "mousePath",
          points: parsed.points,
          origin: toCanvasCommandOrigin(parsed.origin),
          selector: parsed.selector,
          timeoutMs: parsed.timeoutMs,
          includeStateAfter: parsed.includeStateAfter
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "wait_for_active_text",
    {
      description: ToolDescriptions.waitForActiveText,
      inputSchema: {
        text: WaitForActiveTextToolInputBaseSchema.shape.text,
        textGone: WaitForActiveTextToolInputBaseSchema.shape.textGone,
        timeoutMs: WaitForActiveTextToolInputBaseSchema.shape.timeoutMs,
        pollMs: WaitForActiveTextToolInputBaseSchema.shape.pollMs,
        includeStateAfter: WaitForActiveTextToolInputBaseSchema.shape.includeStateAfter,
        autoStart: WaitForActiveTextToolInputBaseSchema.shape.autoStart,
        compact: WaitForActiveTextToolInputBaseSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = WaitForActiveTextToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "waitForText",
          text: parsed.text,
          textGone: parsed.textGone,
          timeoutMs: parsed.timeoutMs,
          pollMs: parsed.pollMs,
          includeStateAfter: parsed.includeStateAfter ?? false
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "wait_for_active_progress",
    {
      description: ToolDescriptions.waitForActiveProgress,
      inputSchema: {
        anyVisibleSelectors: WaitForActiveProgressToolInputBaseSchema.shape.anyVisibleSelectors,
        allHiddenSelectors: WaitForActiveProgressToolInputBaseSchema.shape.allHiddenSelectors,
        timeoutMs: WaitForActiveProgressToolInputBaseSchema.shape.timeoutMs,
        pollMs: WaitForActiveProgressToolInputBaseSchema.shape.pollMs,
        stableForMs: WaitForActiveProgressToolInputBaseSchema.shape.stableForMs,
        includeStateAfter: WaitForActiveProgressToolInputBaseSchema.shape.includeStateAfter,
        autoStart: WaitForActiveProgressToolInputBaseSchema.shape.autoStart,
        compact: WaitForActiveProgressToolInputBaseSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = WaitForActiveProgressToolInputSchema.parse(input);
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "waitForDomState",
          anyVisibleSelectors: parsed.anyVisibleSelectors,
          allHiddenSelectors: parsed.allHiddenSelectors,
          timeoutMs: parsed.timeoutMs,
          pollMs: parsed.pollMs,
          stableForMs: parsed.stableForMs,
          includeStateAfter: parsed.includeStateAfter ?? false
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "select_active_tab_by_url_prefix",
    {
      description: ToolDescriptions.selectActiveTabByUrlPrefix,
      inputSchema: {
        urlPrefix: SelectActiveTabByUrlPrefixToolInputSchema.shape.urlPrefix,
        strategy: SelectActiveTabByUrlPrefixToolInputSchema.shape.strategy,
        autoStart: SelectActiveTabByUrlPrefixToolInputSchema.shape.autoStart,
        compact: SelectActiveTabByUrlPrefixToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = SelectActiveTabByUrlPrefixToolInputSchema.parse(input);
      const strategy = parsed.strategy ?? "last";
      const tabsPayload = await runSingleActiveCommand(
        apiRequest,
        { type: "listTabs" },
        parsed.autoStart ?? true
      );
      const tabs = ((tabsPayload.command.data as { tabs?: TabInfo[] } | undefined)?.tabs ?? []).filter((tab) =>
        tab.url.startsWith(parsed.urlPrefix)
      );
      if (tabs.length === 0) {
        throw new Error(`No active-profile tabs matched urlPrefix "${parsed.urlPrefix}".`);
      }

      const selectedTab = strategy === "first" ? tabs[0] : tabs[tabs.length - 1];
      if (!selectedTab) {
        throw new Error(`No tab could be selected for urlPrefix "${parsed.urlPrefix}".`);
      }

      const selectPayload = await runSingleActiveCommand(
        apiRequest,
        { type: "selectTab", tabIndex: selectedTab.index },
        parsed.autoStart ?? true
      );

      return toText(
        formatSingleCommandOutput(selectPayload, parsed.compact ?? false, {
          selectedTab,
          matchedTabCount: tabs.length,
          strategy
        })
      );
    }
  );

  server.registerTool(
    "get_active_page_state",
    {
      description: ToolDescriptions.getActivePageState,
      inputSchema: {
        includeTextExcerpt: GetActivePageStateToolInputSchema.shape.includeTextExcerpt,
        includeControlSummary: GetActivePageStateToolInputSchema.shape.includeControlSummary,
        maxControls: GetActivePageStateToolInputSchema.shape.maxControls,
        maxTextChars: GetActivePageStateToolInputSchema.shape.maxTextChars,
        includeHtml: GetActivePageStateToolInputSchema.shape.includeHtml,
        autoStart: GetActivePageStateToolInputSchema.shape.autoStart,
        compact: GetActivePageStateToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = GetActivePageStateToolInputSchema.parse(input ?? {});
      const payload = await runSingleActiveCommand(
        apiRequest,
        {
          type: "getPageState",
          includeTextExcerpt: parsed.includeTextExcerpt ?? true,
          includeControlSummary: parsed.includeControlSummary ?? true,
          maxControls: parsed.maxControls,
          maxTextChars: parsed.maxTextChars,
          includeHtml: parsed.includeHtml ?? false
        },
        parsed.autoStart ?? true
      );
      return toText(formatSingleCommandOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "capture_active_screenshot",
    {
      description: ToolDescriptions.captureActiveScreenshot,
      inputSchema: {
        tabIndex: z.number().int().min(0).optional(),
        fullPage: z.boolean().optional(),
        path: z.string().min(1).max(500).optional(),
        autoStart: z.boolean().optional(),
        autoDeleteAfterMs: z.number().int().min(0).max(86_400_000).optional()
      }
    },
    async (input) => {
      const parsed = CaptureActiveScreenshotToolInputSchema.parse(input ?? {});
      const payload = await apiRequest("/control/active/screenshot", {
        method: "POST",
        body: JSON.stringify({
          tabIndex: parsed.tabIndex,
          fullPage: parsed.fullPage ?? false,
          path: parsed.path,
          autoStart: parsed.autoStart ?? true,
          autoDeleteAfterMs: parsed.autoDeleteAfterMs ?? 0
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "delete_artifact",
    {
      description: ToolDescriptions.deleteArtifact,
      inputSchema: {
        path: z.string().min(1).max(500)
      }
    },
    async (input) => {
      const parsed = DeleteArtifactToolInputSchema.parse(input);
      const payload = await apiRequest("/artifacts/delete", {
        method: "POST",
        body: JSON.stringify({
          path: parsed.path
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "delete_profile",
    {
      description: ToolDescriptions.deleteProfile,
      inputSchema: {
        profileId: z.string().uuid()
      }
    },
    async (input) => {
      const parsed = ProfileIdToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}`, {
        method: "DELETE"
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "start_profile",
    {
      description: ToolDescriptions.startProfile,
      inputSchema: {
        profileId: z.string().uuid()
      }
    },
    async (input) => {
      const parsed = ProfileIdToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}/start`, {
        method: "POST"
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "stop_profile",
    {
      description: ToolDescriptions.stopProfile,
      inputSchema: {
        profileId: z.string().uuid()
      }
    },
    async (input) => {
      const parsed = ProfileIdToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}/stop`, {
        method: "POST"
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "run_commands",
    {
      description: ToolDescriptions.runCommands,
      inputSchema: {
        profileId: RunCommandsToolInputSchema.shape.profileId,
        autoStart: RunCommandsToolInputSchema.shape.autoStart,
        compact: RunCommandsToolInputSchema.shape.compact,
        commands: RunCommandsToolInputSchema.shape.commands
      }
    },
    async (input) => {
      const parsed = RunCommandsToolInputSchema.parse(input);
      const payload = await apiRequest<CommandBatchResponse>(`/profiles/${parsed.profileId}/commands`, {
        method: "POST",
        body: JSON.stringify({
          commands: parsed.commands,
          autoStart: parsed.autoStart ?? true
        })
      });
      return toText(formatBatchOutput(payload, parsed.compact ?? false));
    }
  );

  server.registerTool(
    "list_backups",
    {
      description: ToolDescriptions.listBackups,
      inputSchema: {
        profileId: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(500).optional()
      }
    },
    async (input) => {
      const parsed = ListBackupsToolInputSchema.parse(input ?? {});
      const query = new URLSearchParams();
      if (parsed.profileId) {
        query.set("profileId", parsed.profileId);
      }
      if (parsed.limit !== undefined) {
        query.set("limit", String(parsed.limit));
      }
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const payload = await apiRequest(`/backups${suffix}`);
      return toText(payload);
    }
  );

  server.registerTool(
    "backup_profile",
    {
      description: ToolDescriptions.backupProfile,
      inputSchema: {
        profileId: z.string().uuid(),
        destinationDir: z.string().min(1).optional(),
        label: z.string().min(1).max(200).optional()
      }
    },
    async (input) => {
      const parsed = BackupProfileToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}/backup`, {
        method: "POST",
        body: JSON.stringify({
          destinationDir: parsed.destinationDir,
          label: parsed.label
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "restore_profile_backup",
    {
      description: ToolDescriptions.restoreProfileBackup,
      inputSchema: {
        profileId: z.string().uuid(),
        backupId: z.string().uuid(),
        autoStart: z.boolean().optional(),
        setActive: z.boolean().optional()
      }
    },
    async (input) => {
      const parsed = RestoreProfileBackupToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}/restore`, {
        method: "POST",
        body: JSON.stringify({
          backupId: parsed.backupId,
          autoStart: parsed.autoStart ?? false,
          setActive: parsed.setActive ?? false
        })
      });
      return toText(payload);
    }
  );

  server.registerTool(
    "ensure_piskel_profile",
    {
      description: ToolDescriptions.ensurePiskelProfile,
      inputSchema: {
        headless: EnsurePiskelProfileToolInputSchema.shape.headless
      }
    },
    async (input) => {
      const parsed = EnsurePiskelProfileToolInputSchema.parse(input ?? {});
      const profilesPayload = await apiRequest<ProfilesResponse>("/profiles");
      const existing = profilesPayload.profiles.find(
        (p) => p.name.toLowerCase() === "piscel art tester"
      );
      if (existing) {
        return toText({ profile: existing, created: false });
      }
      const created = await apiRequest("/profiles", {
        method: "POST",
        body: JSON.stringify({
          name: "Piscel art tester",
          engine: "chrome",
          settings: {
            headless: parsed.headless ?? false
          }
        })
      });
      return toText({ profile: created, created: true });
    }
  );

  server.registerTool(
    "draw_piskel_pattern",
    {
      description: ToolDescriptions.drawPiskelPattern,
      inputSchema: {
        pattern: DrawPiskelPatternToolInputSchema.shape.pattern,
        cols: DrawPiskelPatternToolInputSchema.shape.cols,
        canvasSelector: DrawPiskelPatternToolInputSchema.shape.canvasSelector,
        strategy: DrawPiskelPatternToolInputSchema.shape.strategy,
        autoStart: DrawPiskelPatternToolInputSchema.shape.autoStart,
        compact: DrawPiskelPatternToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = DrawPiskelPatternToolInputSchema.parse(input);
      // Use the verified Piskel drawing-canvas selector (not bare "canvas" which also matches
      // overlay and preview canvases, causing clicks to land on the wrong element)
      const selector = parsed.canvasSelector ?? "canvas.drawing-canvas";
      const autoStart = parsed.autoStart ?? true;
      const strategy = parsed.strategy ?? "drag";
      const numRows = parsed.pattern.length;
      const numCols = parsed.cols ?? (parsed.pattern[0]?.length ?? 1);

      // Step 1: get canvas bounding box (1 API call, no screenshot)
      const boundsBatch = await apiRequest<CommandBatchResponse>("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({
          autoStart,
          commands: [{ type: "getElementBounds", selector }]
        })
      });
      const boundsResult = boundsBatch.results?.[0];
      if (!boundsResult?.ok) {
        throw new Error(boundsResult?.error ?? `getElementBounds failed for selector "${selector}". Is the Piskel editor loaded?`);
      }
      const bounds = boundsResult.data as { width: number; height: number };
      const cellW = bounds.width / numCols;
      const cellH = bounds.height / numRows;

      // Step 2: build draw commands — drag strategy groups consecutive filled cells in each
      // row into a single mouseDrag sweep (~5x fewer commands than per-pixel clicks)
      const drawCommands: BrowserCommand[] = [];
      let pixelsDrawn = 0;

      for (let row = 0; row < numRows; row += 1) {
        const rowData = parsed.pattern[row];
        if (!rowData) continue;
        const cy = Math.round((row + 0.5) * cellH);

        if (strategy === "drag") {
          // Run-length encode the row into consecutive filled segments
          let col = 0;
          while (col < numCols) {
            if (rowData[col] !== 1) { col += 1; continue; }
            const runStart = col;
            while (col < numCols && rowData[col] === 1) col += 1;
            const runEnd = col - 1;
            const filled = runEnd - runStart + 1;
            pixelsDrawn += filled;
            drawCommands.push({
              type: "mouseDrag",
              origin: "element",
              selector,
              from: { x: Math.round((runStart + 0.5) * cellW), y: cy },
              to:   { x: Math.round((runEnd   + 0.5) * cellW), y: cy },
              includeStateAfter: false
            });
          }
        } else {
          // click strategy: one mouse click per filled cell
          for (let col = 0; col < numCols; col += 1) {
            if (rowData[col] !== 1) continue;
            pixelsDrawn += 1;
            drawCommands.push({
              type: "mouse",
              action: "click",
              origin: "element",
              selector,
              coordinates: {
                x: Math.round((col + 0.5) * cellW),
                y: cy
              },
              includeStateAfter: false
            });
          }
        }
      }

      if (drawCommands.length === 0) {
        return toText({ ok: true, pixelsDrawn: 0, commandsSent: 0, message: "Pattern has no filled cells." });
      }

      // Step 3: send all commands in one batch (no intermediate screenshots)
      const drawBatch = await apiRequest<CommandBatchResponse>("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({ autoStart, commands: drawCommands })
      });

      const output = parsed.compact ?? false
        ? {
            strategy,
            pixelsDrawn,
            commandsSent: drawCommands.length,
            canvasBounds: bounds,
            cellSize: { width: cellW, height: cellH },
            total: drawBatch.total,
            successCount: drawBatch.successCount,
            failureCount: Math.max(0, drawBatch.total - drawBatch.successCount)
          }
        : {
            strategy,
            pixelsDrawn,
            commandsSent: drawCommands.length,
            canvasBounds: bounds,
            cellSize: { width: cellW, height: cellH },
            ...drawBatch
          };

      return toText(output);
    }
  );

  server.registerTool(
    "screenshot_active_element",
    {
      description: ToolDescriptions.screenshotActiveElement,
      inputSchema: {
        selector: ScreenshotActiveElementToolInputSchema.shape.selector,
        path: ScreenshotActiveElementToolInputSchema.shape.path,
        timeoutMs: ScreenshotActiveElementToolInputSchema.shape.timeoutMs,
        autoStart: ScreenshotActiveElementToolInputSchema.shape.autoStart,
        autoDeleteAfterMs: ScreenshotActiveElementToolInputSchema.shape.autoDeleteAfterMs
      }
    },
    async (input) => {
      const parsed = ScreenshotActiveElementToolInputSchema.parse(input ?? {});
      const payload = await apiRequest<{
        screenshot: { ok: boolean; data?: { path?: string } };
        artifactPath?: string;
        deleteAt?: string | null;
      }>("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({
          autoStart: parsed.autoStart ?? true,
          commands: [{
            type: "screenshotElement",
            selector: parsed.selector,
            path: parsed.path,
            timeoutMs: parsed.timeoutMs
          }]
        })
      });
      const result = (payload as unknown as { results?: Array<{ ok: boolean; data?: { path?: string }; error?: string }> }).results?.[0];
      if (!result?.ok) {
        throw new Error(result?.error ?? "screenshotElement failed.");
      }
      const artifactPath = result.data?.path;
      if (artifactPath && parsed.autoDeleteAfterMs && parsed.autoDeleteAfterMs > 0) {
        setTimeout(() => {
          import("node:fs/promises").then(({ unlink }) => unlink(artifactPath).catch(() => {}));
        }, parsed.autoDeleteAfterMs);
      }
      return toText({ ok: true, path: artifactPath, selector: parsed.selector });
    }
  );

  server.registerTool(
    "screenshot_active_region",
    {
      description: ToolDescriptions.screenshotActiveRegion,
      inputSchema: {
        x: ScreenshotActiveRegionToolInputSchema.shape.x,
        y: ScreenshotActiveRegionToolInputSchema.shape.y,
        width: ScreenshotActiveRegionToolInputSchema.shape.width,
        height: ScreenshotActiveRegionToolInputSchema.shape.height,
        path: ScreenshotActiveRegionToolInputSchema.shape.path,
        autoStart: ScreenshotActiveRegionToolInputSchema.shape.autoStart,
        autoDeleteAfterMs: ScreenshotActiveRegionToolInputSchema.shape.autoDeleteAfterMs
      }
    },
    async (input) => {
      const parsed = ScreenshotActiveRegionToolInputSchema.parse(input ?? {});
      const batchPayload = await apiRequest<CommandBatchResponse>("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({
          autoStart: parsed.autoStart ?? true,
          commands: [{
            type: "screenshotRegion",
            x: parsed.x,
            y: parsed.y,
            width: parsed.width,
            height: parsed.height,
            path: parsed.path
          }]
        })
      });
      const result = batchPayload.results?.[0];
      if (!result?.ok) {
        throw new Error(result?.error ?? "screenshotRegion failed.");
      }
      const artifactPath = (result.data as { path?: string } | undefined)?.path;
      if (artifactPath && parsed.autoDeleteAfterMs && parsed.autoDeleteAfterMs > 0) {
        setTimeout(() => {
          import("node:fs/promises").then(({ unlink }) => unlink(artifactPath).catch(() => {}));
        }, parsed.autoDeleteAfterMs);
      }
      return toText({ ok: true, path: artifactPath, region: { x: parsed.x, y: parsed.y, width: parsed.width, height: parsed.height } });
    }
  );

  server.registerTool(
    "get_canvas_pixels",
    {
      description: ToolDescriptions.getCanvasPixels,
      inputSchema: {
        selector: GetCanvasPixelsToolInputSchema.shape.selector,
        downsampleTo: GetCanvasPixelsToolInputSchema.shape.downsampleTo,
        nonTransparentOnly: GetCanvasPixelsToolInputSchema.shape.nonTransparentOnly,
        format: GetCanvasPixelsToolInputSchema.shape.format,
        timeoutMs: GetCanvasPixelsToolInputSchema.shape.timeoutMs,
        autoStart: GetCanvasPixelsToolInputSchema.shape.autoStart,
        compact: GetCanvasPixelsToolInputSchema.shape.compact
      }
    },
    async (input) => {
      const parsed = GetCanvasPixelsToolInputSchema.parse(input ?? {});
      const batchPayload = await apiRequest<CommandBatchResponse>("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({
          autoStart: parsed.autoStart ?? true,
          commands: [{
            type: "getCanvasPixels",
            selector: parsed.selector,
            downsampleTo: parsed.downsampleTo,
            nonTransparentOnly: parsed.nonTransparentOnly ?? true,
            format: parsed.format ?? "sparse",
            timeoutMs: parsed.timeoutMs
          }]
        })
      });
      const result = batchPayload.results?.[0];
      if (!result?.ok) {
        throw new Error(result?.error ?? "getCanvasPixels failed.");
      }
      return toText(formatBatchOutput(batchPayload, parsed.compact ?? true));
    }
  );
};
