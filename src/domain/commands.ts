import { z } from "zod";

export const NavigateCommandSchema = z.object({
  type: z.literal("navigate"),
  url: z.string().url(),
  waitUntil: z.enum(["commit", "domcontentloaded", "load", "networkidle"]).optional(),
  tabIndex: z.number().int().min(0).optional()
});

export const ClickCommandSchema = z.object({
  type: z.literal("click"),
  selector: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  tabIndex: z.number().int().min(0).optional()
});

const MouseCoordinateSchema = z.number().finite().min(-100_000).max(100_000);

const MousePointSchema = z.object({
  x: MouseCoordinateSchema,
  y: MouseCoordinateSchema
});

const MouseOriginSchema = z.enum(["viewport", "element"]);

const MouseContextSchema = z
  .object({
    origin: MouseOriginSchema.optional(),
    selector: z.string().min(1).max(500).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    includeStateAfter: z.boolean().optional(),
    tabIndex: z.number().int().min(0).optional()
  })
  .refine((value) => value.origin !== "element" || Boolean(value.selector), {
    message: "selector is required when origin is element."
  });

export const MouseCommandSchema = MouseContextSchema.extend({
  type: z.literal("mouse"),
  action: z.enum(["move", "down", "up", "click"]),
  coordinates: MousePointSchema
});

export const MouseDragCommandSchema = MouseContextSchema.extend({
  type: z.literal("mouseDrag"),
  from: MousePointSchema,
  to: MousePointSchema
});

export const MousePathCommandSchema = MouseContextSchema.extend({
  type: z.literal("mousePath"),
  points: z.array(MousePointSchema).min(2).max(500)
});

export const ClickByTextCommandSchema = z.object({
  type: z.literal("clickByText"),
  text: z.string().min(1),
  occurrence: z.number().int().positive().max(100).optional(),
  tag: z.enum(["button", "a", "any"]).optional(),
  exact: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  includeStateAfter: z.boolean().optional(),
  tabIndex: z.number().int().min(0).optional()
});

export const TypeCommandSchema = z.object({
  type: z.literal("type"),
  selector: z.string().min(1),
  text: z.string(),
  clear: z.boolean().optional(),
  includeStateAfter: z.boolean().optional(),
  tabIndex: z.number().int().min(0).optional()
});

export const TypeIntoPromptCommandSchema = z.object({
  type: z.literal("typeIntoPrompt"),
  text: z.string(),
  clear: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  includeStateAfter: z.boolean().optional()
});

export const SubmitPromptCommandSchema = z.object({
  type: z.literal("submitPrompt"),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  includeStateAfter: z.boolean().optional()
});

export const PressCommandSchema = z.object({
  type: z.literal("press"),
  key: z.string().min(1).max(50),
  includeStateAfter: z.boolean().optional()
});

export const ExtractTextCommandSchema = z.object({
  type: z.literal("extractText"),
  selector: z.string().min(1)
});

export const GetPageStateCommandSchema = z.object({
  type: z.literal("getPageState"),
  includeHtml: z.boolean().optional(),
  includeTextExcerpt: z.boolean().optional(),
  includeControlSummary: z.boolean().optional(),
  maxControls: z.number().int().positive().max(500).optional(),
  maxTextChars: z.number().int().positive().max(20000).optional(),
  tabIndex: z.number().int().min(0).optional()
});

export const WaitForTextCommandSchema = z
  .object({
    type: z.literal("waitForText"),
    text: z.string().min(1).optional(),
    textGone: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    pollMs: z.number().int().min(25).max(10_000).optional(),
    includeStateAfter: z.boolean().optional()
  })
  .refine((value) => Boolean(value.text || value.textGone), {
    message: "Provide text and/or textGone."
  });

export const WaitForDomStateCommandSchema = z
  .object({
    type: z.literal("waitForDomState"),
    anyVisibleSelectors: z.array(z.string().min(1).max(500)).max(100).optional(),
    allHiddenSelectors: z.array(z.string().min(1).max(500)).max(100).optional(),
    timeoutMs: z.number().int().positive().max(120_000).optional(),
    pollMs: z.number().int().min(25).max(10_000).optional(),
    stableForMs: z.number().int().min(0).max(120_000).optional(),
    includeStateAfter: z.boolean().optional()
  })
  .refine((value) => Boolean((value.anyVisibleSelectors?.length ?? 0) > 0 || (value.allHiddenSelectors?.length ?? 0) > 0), {
    message: "Provide anyVisibleSelectors and/or allHiddenSelectors."
  });

export const SnapshotCommandSchema = z.object({
  type: z.literal("snapshot"),
  maxElements: z.number().int().positive().max(500).optional(),
  tabIndex: z.number().int().min(0).optional()
});

export const ClickRefCommandSchema = z.object({
  type: z.literal("clickRef"),
  ref: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  strictSnapshot: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  includeStateAfter: z.boolean().optional()
});

export const TypeRefCommandSchema = z.object({
  type: z.literal("typeRef"),
  ref: z.string().min(1),
  snapshotId: z.string().min(1).optional(),
  strictSnapshot: z.boolean().optional(),
  text: z.string(),
  clear: z.boolean().optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional(),
  includeStateAfter: z.boolean().optional()
});

export const ScreenshotCommandSchema = z.object({
  type: z.literal("screenshot"),
  tabIndex: z.number().int().min(0).optional(),
  path: z.string().min(1).optional(),
  fullPage: z.boolean().optional()
});

export const EvaluateCommandSchema = z.object({
  type: z.literal("evaluate"),
  expression: z.string().min(1)
});

export const GetElementBoundsCommandSchema = z.object({
  type: z.literal("getElementBounds"),
  selector: z.string().min(1).max(500),
  timeoutMs: z.number().int().positive().max(120_000).optional()
});

export const ScreenshotElementCommandSchema = z.object({
  type: z.literal("screenshotElement"),
  selector: z.string().min(1).max(500),
  path: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional()
});

export const ScreenshotRegionCommandSchema = z.object({
  type: z.literal("screenshotRegion"),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  path: z.string().min(1).optional()
});

export const GetCanvasPixelsCommandSchema = z.object({
  type: z.literal("getCanvasPixels"),
  selector: z.string().min(1).max(500),
  downsampleTo: z.number().int().min(1).max(256).optional(),
  nonTransparentOnly: z.boolean().optional(),
  format: z.enum(["sparse", "grid"]).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional()
});

export const ListTabsCommandSchema = z.object({
  type: z.literal("listTabs")
});

export const NewTabCommandSchema = z.object({
  type: z.literal("newTab"),
  url: z.string().url().optional()
});

export const SelectTabCommandSchema = z.object({
  type: z.literal("selectTab"),
  tabIndex: z.number().int().min(0)
});

export const CloseTabCommandSchema = z.object({
  type: z.literal("closeTab"),
  tabIndex: z.number().int().min(0).optional()
});

export const GetTabTextCommandSchema = z.object({
  type: z.literal("getTabText"),
  tabIndex: z.number().int().min(0),
  maxChars: z.number().int().positive().max(20000).optional()
});

export const ScrollCommandSchema = z.object({
  type: z.literal("scroll"),
  x: z.number().finite(),
  y: z.number().finite(),
  deltaX: z.number().finite().optional(),
  deltaY: z.number().finite().optional(),
  tabIndex: z.number().int().min(0).optional()
});

export const BrowserCommandSchema = z.discriminatedUnion("type", [
  NavigateCommandSchema,
  ClickCommandSchema,
  MouseCommandSchema,
  MouseDragCommandSchema,
  MousePathCommandSchema,
  ClickByTextCommandSchema,
  TypeCommandSchema,
  TypeIntoPromptCommandSchema,
  SubmitPromptCommandSchema,
  PressCommandSchema,
  ExtractTextCommandSchema,
  GetPageStateCommandSchema,
  WaitForTextCommandSchema,
  WaitForDomStateCommandSchema,
  SnapshotCommandSchema,
  ClickRefCommandSchema,
  TypeRefCommandSchema,
  ScreenshotCommandSchema,
  EvaluateCommandSchema,
  GetElementBoundsCommandSchema,
  ScreenshotElementCommandSchema,
  ScreenshotRegionCommandSchema,
  GetCanvasPixelsCommandSchema,
  ListTabsCommandSchema,
  NewTabCommandSchema,
  SelectTabCommandSchema,
  CloseTabCommandSchema,
  GetTabTextCommandSchema,
  ScrollCommandSchema
]);

export type BrowserCommand = z.infer<typeof BrowserCommandSchema>;

export const RunCommandsRequestSchema = z.object({
  commands: z.array(BrowserCommandSchema).min(1),
  autoStart: z.boolean().default(true)
});
export type RunCommandsRequest = z.infer<typeof RunCommandsRequestSchema>;

export interface CommandExecutionResult {
  type: BrowserCommand["type"];
  ok: boolean;
  data?: unknown;
  error?: string;
}
