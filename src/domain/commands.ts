import { z } from "zod";

export const NavigateCommandSchema = z.object({
  type: z.literal("navigate"),
  url: z.string().url(),
  waitUntil: z.enum(["commit", "domcontentloaded", "load", "networkidle"]).optional()
});

export const ClickCommandSchema = z.object({
  type: z.literal("click"),
  selector: z.string().min(1),
  timeoutMs: z.number().int().positive().max(120_000).optional()
});

export const TypeCommandSchema = z.object({
  type: z.literal("type"),
  selector: z.string().min(1),
  text: z.string(),
  clear: z.boolean().optional()
});

export const PressCommandSchema = z.object({
  type: z.literal("press"),
  key: z.string().min(1).max(50)
});

export const ExtractTextCommandSchema = z.object({
  type: z.literal("extractText"),
  selector: z.string().min(1)
});

export const GetPageStateCommandSchema = z.object({
  type: z.literal("getPageState"),
  includeHtml: z.boolean().optional(),
  includeTextExcerpt: z.boolean().optional()
});

export const ScreenshotCommandSchema = z.object({
  type: z.literal("screenshot"),
  path: z.string().min(1).optional(),
  fullPage: z.boolean().optional()
});

export const EvaluateCommandSchema = z.object({
  type: z.literal("evaluate"),
  expression: z.string().min(1)
});

export const BrowserCommandSchema = z.discriminatedUnion("type", [
  NavigateCommandSchema,
  ClickCommandSchema,
  TypeCommandSchema,
  PressCommandSchema,
  ExtractTextCommandSchema,
  GetPageStateCommandSchema,
  ScreenshotCommandSchema,
  EvaluateCommandSchema
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

