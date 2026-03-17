import { z } from "zod";

const ProxySettingsSchema = z
  .object({
    server: z.string().min(3),
    username: z.string().optional(),
    password: z.string().optional()
  })
  .optional();

const EngineSchema = z.enum(["chromium", "firefox"]).default("chromium");

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
  commands: z
    .array(
      z
        .object({
          type: z.string().min(1)
        })
        .passthrough()
    )
    .min(1)
});

export const SetActiveProfileToolInputSchema = z.object({
  profileId: z.string().uuid(),
  autoStart: z.boolean().optional()
});

export const RunActiveCommandsToolInputSchema = z.object({
  autoStart: z.boolean().optional(),
  commands: z
    .array(
      z
        .object({
          type: z.string().min(1)
        })
        .passthrough()
    )
    .min(1)
});

export const EnsureGeminiProfileToolInputSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().optional(),
  userAgent: z.string().optional()
});

export const OpenGeminiSessionToolInputSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().optional(),
  autoSetActive: z.boolean().optional(),
  targetUrl: z.string().url().optional()
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
    "Run one or more browser commands for a profile (navigate, click, type, extract text, screenshot, etc.).",
  getProfile: "Get profile details and running state.",
  setActiveProfile:
    "Mark a profile as the active takeover target so future active commands can control it directly.",
  runActiveCommands:
    "Run commands on the currently selected active/takeover profile without providing profile id each call.",
  getControlState: "Get active takeover profile state.",
  ensureGeminiProfile:
    "Create or reconcile a Gemini-ready persistent profile that reuses local Gemini login session data.",
  openGeminiSession:
    "Open a Gemini session in the persistent Gemini profile, and optionally set it as active takeover profile."
};
