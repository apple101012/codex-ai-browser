import { z } from "zod";
import {
  ProxyConfigInputSchema,
  ProxyConfigSchema
} from "../proxy/proxyTypes.js";

export const BrowserEngineSchema = z.enum(["chrome", "msedge", "chromium", "firefox"]);
export type BrowserEngine = z.infer<typeof BrowserEngineSchema>;

export const ProfileSettingsSchema = z.object({
  userAgent: z.string().min(3).max(800).optional(),
  proxy: ProxyConfigSchema.nullish(),
  headless: z.boolean().optional()
});
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;

export const ProfileSettingsInputSchema = z.object({
  userAgent: z.string().min(3).max(800).optional(),
  proxy: ProxyConfigInputSchema,
  headless: z.boolean().optional()
});
export type ProfileSettingsInput = z.infer<typeof ProfileSettingsInputSchema>;

export const SavedTabSchema = z.object({
  url: z.string(),
  active: z.boolean()
});
export type SavedTab = z.infer<typeof SavedTabSchema>;

export const ProfileRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  engine: BrowserEngineSchema,
  settings: ProfileSettingsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dataDir: z.string().min(1),
  managedDataDir: z.boolean().default(true),
  savedTabs: z.array(SavedTabSchema).optional()
});
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

export const CreateProfileInputSchema = z.object({
  name: z.string().min(1).max(200),
  engine: BrowserEngineSchema.default("chrome"),
  settings: ProfileSettingsInputSchema.default({}),
  externalDataDir: z.string().min(1).optional()
});
export type CreateProfileInput = z.infer<typeof CreateProfileInputSchema>;

export const UpdateProfileInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  engine: BrowserEngineSchema.optional(),
  settings: ProfileSettingsInputSchema.partial().optional(),
  externalDataDir: z.string().min(1).optional()
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
