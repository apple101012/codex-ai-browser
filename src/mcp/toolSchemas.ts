import { z } from "zod";
import { BrowserCommandSchema } from "../domain/commands.js";

const CanvasOriginSchema = z.enum(["viewport", "selector"]);

const CanvasCoordinateSchema = z.number().finite().min(-100_000).max(100_000);

const CanvasPointSchema = z.object({
  x: CanvasCoordinateSchema,
  y: CanvasCoordinateSchema
});

const CanvasTargetShape = {
  origin: CanvasOriginSchema.optional(),
  selector: z.string().min(1).max(500).optional()
} as const;

const validateCanvasTarget = (
  value: { origin?: "viewport" | "selector"; selector?: string | undefined },
  ctx: z.RefinementCtx
): void => {
  if (value.origin === "selector" && !value.selector) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["selector"],
      message: 'Provide selector when origin is "selector".'
    });
  }
};

const ProxySettingsSchema = z
  .object({
    server: z.string().min(3),
    username: z.string().optional(),
    password: z.string().optional()
  })
  .optional();

const EngineSchema = z.enum(["chrome", "msedge", "chromium", "firefox"]).default("chrome");

export const CreateProfileToolInputSchema = z.object({
  name: z.string().min(1),
  engine: EngineSchema.optional(),
  userAgent: z.string().optional(),
  headless: z.boolean().optional(),
  proxy: ProxySettingsSchema,
  externalDataDir: z.string().min(1).optional()
});

export const UpdateProfileToolInputSchema = z.object({
  profileId: z.string().uuid(),
  name: z.string().optional(),
  engine: EngineSchema.optional(),
  userAgent: z.string().optional(),
  headless: z.boolean().optional(),
  proxy: ProxySettingsSchema,
  externalDataDir: z.string().min(1).optional()
});

export const ProfileIdToolInputSchema = z.object({
  profileId: z.string().uuid()
});

export const RunCommandsToolInputSchema = z.object({
  profileId: z.string().uuid(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional(),
  commands: z.array(BrowserCommandSchema).min(1)
});

export const SetActiveProfileToolInputSchema = z.object({
  profileId: z.string().uuid(),
  autoStart: z.boolean().optional()
});

export const EnsureActiveProfileToolInputSchema = z.object({
  profileId: z.string().uuid().optional(),
  profileName: z.string().min(1).max(200).optional(),
  autoStart: z.boolean().optional(),
  setActive: z.boolean().optional(),
  preferRunningBrowserProfile: z.boolean().optional(),
  allowAnyRunningFallback: z.boolean().optional()
});

export const RunActiveCommandsToolInputSchema = z.object({
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional(),
  commands: z.array(BrowserCommandSchema).min(1)
});

export const ClickActiveCanvasToolInputSchema = z.object({
  x: CanvasCoordinateSchema,
  y: CanvasCoordinateSchema,
  ...CanvasTargetShape,
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
}).superRefine(validateCanvasTarget);

export const DragActiveCanvasToolInputSchema = z.object({
  startX: CanvasCoordinateSchema,
  startY: CanvasCoordinateSchema,
  endX: CanvasCoordinateSchema,
  endY: CanvasCoordinateSchema,
  ...CanvasTargetShape,
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
}).superRefine(validateCanvasTarget);

export const PathActiveCanvasToolInputSchema = z.object({
  points: z.array(CanvasPointSchema).min(2).max(500),
  ...CanvasTargetShape,
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
}).superRefine(validateCanvasTarget);

export const SnapshotActivePageToolInputSchema = z.object({
  maxElements: z.number().int().min(1).max(500).optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const ClickActiveRefToolInputSchema = z.object({
  ref: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  strictSnapshot: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const TypeActiveRefToolInputSchema = z.object({
  ref: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  strictSnapshot: z.boolean().optional(),
  text: z.string(),
  clear: z.boolean().optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const WaitForActiveTextToolInputBaseSchema = z.object({
  text: z.string().min(1).optional(),
  textGone: z.string().min(1).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  pollMs: z.number().int().min(25).max(5_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const WaitForActiveTextToolInputSchema = WaitForActiveTextToolInputBaseSchema.refine(
  (value) => Boolean(value.text || value.textGone),
  {
    message: "Provide at least one of text or textGone."
  }
);

export const GetActivePageStateToolInputSchema = z.object({
  includeTextExcerpt: z.boolean().optional(),
  includeControlSummary: z.boolean().optional(),
  maxControls: z.number().int().min(1).max(300).optional(),
  maxTextChars: z.number().int().min(100).max(100_000).optional(),
  includeHtml: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const WaitForActiveProgressToolInputBaseSchema = z.object({
  anyVisibleSelectors: z.array(z.string().min(1).max(500)).max(100).optional(),
  allHiddenSelectors: z.array(z.string().min(1).max(500)).max(100).optional(),
  timeoutMs: z.number().int().min(100).max(120_000).optional(),
  pollMs: z.number().int().min(25).max(5_000).optional(),
  stableForMs: z.number().int().min(0).max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const WaitForActiveProgressToolInputSchema = WaitForActiveProgressToolInputBaseSchema.refine(
  (value) => Boolean((value.anyVisibleSelectors?.length ?? 0) > 0 || (value.allHiddenSelectors?.length ?? 0) > 0),
  {
    message: "Provide anyVisibleSelectors and/or allHiddenSelectors."
  }
);

export const SelectActiveTabByUrlPrefixToolInputSchema = z.object({
  urlPrefix: z.string().min(1),
  strategy: z.enum(["first", "last"]).optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const ReleaseActiveProfileToolInputSchema = z.object({});

export const EnsureGeminiProfileToolInputSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().optional(),
  userAgent: z.string().optional()
});
export const EnsureBrowserProfileToolInputSchema = EnsureGeminiProfileToolInputSchema;

export const OpenGeminiSessionToolInputSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().optional(),
  autoSetActive: z.boolean().optional(),
  targetUrl: z.string().url().optional()
});

export const OpenUrlSessionToolInputSchema = z.object({
  url: z.string().url(),
  profileId: z.string().uuid().optional(),
  autoSetActive: z.boolean().optional(),
  autoStart: z.boolean().optional()
});

export const CaptureActiveScreenshotToolInputSchema = z.object({
  tabIndex: z.number().int().min(0).optional(),
  fullPage: z.boolean().optional(),
  path: z.string().min(1).max(500).optional(),
  autoStart: z.boolean().optional(),
  autoDeleteAfterMs: z.number().int().min(0).max(86_400_000).optional()
});

export const DeleteArtifactToolInputSchema = z.object({
  path: z.string().min(1).max(500)
});

export const ListBackupsToolInputSchema = z.object({
  profileId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(500).optional()
});

export const BackupProfileToolInputSchema = z.object({
  profileId: z.string().uuid(),
  destinationDir: z.string().min(1).optional(),
  label: z.string().min(1).max(200).optional()
});

export const RestoreProfileBackupToolInputSchema = z.object({
  profileId: z.string().uuid(),
  backupId: z.string().uuid(),
  autoStart: z.boolean().optional(),
  setActive: z.boolean().optional()
});

export const EnsurePiskelProfileToolInputSchema = z.object({
  headless: z.boolean().optional()
});

export const DrawPiskelPatternToolInputSchema = z.object({
  pattern: z.array(z.array(z.number().int().min(0).max(1))).min(1).max(64),
  cols: z.number().int().min(1).max(64).optional(),
  canvasSelector: z.string().min(1).max(500).optional(),
  strategy: z.enum(["drag", "click"]).optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const ScreenshotActiveElementToolInputSchema = z.object({
  selector: z.string().min(1).max(500),
  path: z.string().min(1).max(500).optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  autoStart: z.boolean().optional(),
  autoDeleteAfterMs: z.number().int().min(0).max(86_400_000).optional()
});

export const ScreenshotActiveRegionToolInputSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  path: z.string().min(1).max(500).optional(),
  autoStart: z.boolean().optional(),
  autoDeleteAfterMs: z.number().int().min(0).max(86_400_000).optional()
});

export const GetCanvasPixelsToolInputSchema = z.object({
  selector: z.string().min(1).max(500),
  downsampleTo: z.number().int().min(1).max(256).optional(),
  nonTransparentOnly: z.boolean().optional(),
  format: z.enum(["sparse", "grid"]).optional(),
  timeoutMs: z.number().int().min(1).max(120_000).optional(),
  autoStart: z.boolean().optional(),
  compact: z.boolean().optional()
});

export const ToolDescriptions = {
  listProfiles: "List all persisted browser profiles and currently running profiles.",
  createProfile:
    "Create a new persistent browser profile with optional user-agent spoofing and proxy settings.",
  updateProfile:
    "Update profile metadata/settings such as user agent, proxy, engine, or headless mode.",
  startProfile: "Start a persistent browser context for a profile.",
  stopProfile: "Stop a running browser context for a profile.",
  runCommands:
    "Run one or more browser commands for a profile. Supports Playwright-style ref commands plus canvas commands (`mouse`, `mouseDrag`, `mousePath`). Raw selector-relative commands use `origin: \"element\"` with `selector`.",
  getProfile: "Get profile details and running state.",
  setActiveProfile:
    "Mark a profile as the active takeover target so future active commands can control it directly.",
  ensureActiveProfile:
    "Resolve active profile in order: explicit id/name -> existing active -> running Browser Profile -> optional any-running fallback (allowAnyRunningFallback).",
  releaseActiveProfile:
    "Release the active takeover profile so agents stop controlling a selected browser profile.",
  runActiveCommands:
    "Run commands on the currently selected active/takeover profile without profile id. Supports Playwright-style ref commands plus canvas commands (`mouse`, `mouseDrag`, `mousePath`). Raw selector-relative commands use `origin: \"element\"` with `selector`.",
  snapshotActivePage:
    "Playwright-style active-page snapshot that returns stable refs plus snapshotId for visible actionable elements. Use this before click/type ref actions.",
  clickActiveRef:
    "Playwright-style active-page click by ref from snapshot_active_page. You can pass snapshotId and strictSnapshot for deterministic stale-ref handling. Defaults to includeStateAfter=false for faster runs.",
  typeActiveRef:
    "Playwright-style active-page type by ref from snapshot_active_page, with optional snapshotId strictness, clear, and state-after capture. Defaults to includeStateAfter=false.",
  clickActiveCanvas:
    "Click on the active page by canvas coordinates. Wrapper input uses `origin: \"viewport\"` or `origin: \"selector\"`; selector mode is translated to raw `origin: \"element\"` plus `selector`.",
  dragActiveCanvas:
    "Drag on the active page between two coordinate pairs. Wrapper input uses selector-relative coordinates without making callers remember the raw `element` origin name.",
  pathActiveCanvas:
    "Trace a multi-point mouse path on the active page. Useful for drawing on canvases or whiteboards with either viewport or selector-relative coordinates.",
  waitForActiveText:
    "Wait on the active page until text appears/disappears (with optional stability window), then optionally return post-wait state.",
  waitForActiveProgress:
    "Wait on active-page DOM signals (selectors visible/hidden) for robust generation/progress workflows beyond text-only waits.",
  selectActiveTabByUrlPrefix:
    "Select the active tab by URL prefix (first/last match), avoiding fragile tab-index assumptions.",
  getActivePageState:
    "Get active page state (URL/title plus optional text excerpt/control summary/HTML) for faster agent decision-making.",
  getControlState: "Get active takeover profile state.",
  ensureGeminiProfile:
    "Create or reconcile a Gemini-ready persistent profile that reuses local Gemini login session data.",
  ensureBrowserProfile:
    "Create or reconcile the default persistent Browser Profile used for first-run local AI control.",
  openGeminiSession:
    "Open a Gemini session in the persistent Gemini profile, and optionally set it as active takeover profile.",
  openUrlSession:
    "Open any URL in a resolved profile (specific profile id or current active profile) and optionally set active control.",
  captureActiveScreenshot:
    "Capture a screenshot from the current active profile in one call (optionally by tab index), with optional timed auto-delete.",
  deleteArtifact:
    "Delete an artifact file under the local artifacts directory. Use this after screenshot analysis to keep storage clean.",
  deleteProfile: "Delete a persisted profile (stopping it first if currently running).",
  listBackups: "List profile backups (optionally filtered by profile id).",
  backupProfile:
    "Create a point-in-time backup of a profile data directory. You can pass destinationDir for VPS-mounted backup paths.",
  restoreProfileBackup:
    "Restore a profile from a previously created backup id, with optional auto-start and active takeover selection.",
  ensurePiskelProfile:
    "Create or find the 'Piscel art tester' Chrome profile used for pixel art drawing tests. Returns the profile record with its id.",
  drawPiskelPattern:
    "Draw a pixel art pattern on the active page's Piskel drawing canvas (canvas.drawing-canvas) in one token-efficient batch. Accepts a 2D binary grid (rows × cols, 1=draw 0=skip). Default strategy='drag': groups consecutive filled cells into row-sweep drags (~5x fewer commands than individual clicks). strategy='click' falls back to per-pixel clicks. No intermediate screenshots needed.",
  screenshotActiveElement:
    "Capture a screenshot of a single DOM element (cropped to its bounding box). 70–82% fewer tokens than a full-page screenshot. Use for initial canvas state inspection and post-draw verification.",
  screenshotActiveRegion:
    "Capture a cropped screenshot of a specific viewport region (x, y, width, height). Use when no stable CSS selector exists for the target element, or to include context around the canvas.",
  getCanvasPixels:
    "Read pixel data from a <canvas> element as JSON — no vision tokens needed. Returns sparse [{x,y,hex}] or grid (2D hex array). Use to verify drawing results programmatically. Requires ALLOW_EVALUATE=true."
};
