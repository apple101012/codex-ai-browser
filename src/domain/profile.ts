import { z } from "zod";

export const BrowserEngineSchema = z.enum(["chrome", "msedge", "chromium", "firefox"]);
export type BrowserEngine = z.infer<typeof BrowserEngineSchema>;

export const ProxyConfigSchema = z.object({
  server: z.string().min(3).max(500),
  username: z.string().min(1).max(200).optional(),
  password: z.string().min(1).max(200).optional()
});
export type ProxyConfig = z.infer<typeof ProxyConfigSchema>;

export const ProfileSettingsSchema = z.object({
  userAgent: z.string().min(3).max(800).optional(),
  proxy: ProxyConfigSchema.optional(),
  headless: z.boolean().optional()
});
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;

export const ProfileRecordSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  engine: BrowserEngineSchema,
  settings: ProfileSettingsSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dataDir: z.string().min(1),
  managedDataDir: z.boolean().default(true)
});
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

export const CreateProfileInputSchema = z.object({
  name: z.string().min(1).max(200),
  engine: BrowserEngineSchema.default("chrome"),
  settings: ProfileSettingsSchema.default({}),
  externalDataDir: z.string().min(1).optional()
});
export type CreateProfileInput = z.infer<typeof CreateProfileInputSchema>;

export const UpdateProfileInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  engine: BrowserEngineSchema.optional(),
  settings: ProfileSettingsSchema.partial().optional(),
  externalDataDir: z.string().min(1).optional()
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
