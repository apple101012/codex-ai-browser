import { z } from "zod";
import {
  ProxyConfigInputSchema,
  ProxyConfigSchema
} from "../proxy/proxyTypes.js";

export const BrowserEngineSchema = z.enum(["chrome", "msedge", "chromium", "firefox"]);
export type BrowserEngine = z.infer<typeof BrowserEngineSchema>;

const windowSizeRefine = (s: { windowWidth?: number; windowHeight?: number }) => {
  const hasWidth = s.windowWidth !== undefined;
  const hasHeight = s.windowHeight !== undefined;
  return hasWidth === hasHeight; // both or neither
};
const windowSizeRefineMsg = { message: "windowWidth and windowHeight must both be set or both omitted" };

export const ProfileSettingsSchema = z.object({
  userAgent: z.string().min(3).max(800).optional(),
  proxy: ProxyConfigSchema.nullish(),
  headless: z.boolean().optional(),
  windowWidth: z.number().int().min(200).max(7680).optional(),
  windowHeight: z.number().int().min(200).max(4320).optional(),
  extensionPaths: z.array(z.string().min(1)).optional()
}).refine(windowSizeRefine, windowSizeRefineMsg);
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;

// Base schema without the both-or-neither refine so it can be used as .partial()
// in UpdateProfileInputSchema (Zod does not allow .partial() on refined schemas).
const ProfileSettingsInputBaseSchema = z.object({
  userAgent: z.string().min(3).max(800).optional(),
  proxy: ProxyConfigInputSchema,
  headless: z.boolean().optional(),
  windowWidth: z.number().int().min(200).max(7680).optional(),
  windowHeight: z.number().int().min(200).max(4320).optional(),
  extensionPaths: z.array(z.string().min(1)).optional()
});

export const ProfileSettingsInputSchema = ProfileSettingsInputBaseSchema
  .refine(windowSizeRefine, windowSizeRefineMsg);
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
  notes: z.string().max(1000).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  dataDir: z.string().min(1),
  managedDataDir: z.boolean().default(true),
  savedTabs: z.array(SavedTabSchema).optional()
});
export type ProfileRecord = z.infer<typeof ProfileRecordSchema>;

// ProfileSettingsInputSchema already enforces the both-or-neither window size invariant
// via its own .refine(), so no additional outer superRefine is needed here.
export const CreateProfileInputSchema = z.object({
  name: z.string().min(1).max(200),
  engine: BrowserEngineSchema.default("chrome"),
  settings: ProfileSettingsInputSchema.default({}),
  notes: z.string().max(1000).optional(),
  externalDataDir: z.string().min(1).optional()
});
export type CreateProfileInput = z.infer<typeof CreateProfileInputSchema>;

// UpdateProfileInputSchema uses the base (unrefined) settings schema with .partial() since
// Zod does not allow .partial() on refined schemas. Partial updates may legitimately send
// only one window dimension (e.g. changing width) when the other already exists in the stored
// profile. The both-or-neither invariant is enforced after the partial settings are merged
// with the stored profile and the final record is validated by ProfileRecordSchema.
// windowWidth/Height are nullable here so a PATCH can clear both dimensions (send null for each).
const ProfileSettingsForUpdateSchema = ProfileSettingsInputBaseSchema.partial().extend({
  windowWidth: z.number().int().min(200).max(7680).optional().nullable(),
  windowHeight: z.number().int().min(200).max(4320).optional().nullable()
});
export const UpdateProfileInputSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  engine: BrowserEngineSchema.optional(),
  settings: ProfileSettingsForUpdateSchema.optional(),
  notes: z.string().max(1000).optional().nullable(),
  externalDataDir: z.string().min(1).optional()
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileInputSchema>;
