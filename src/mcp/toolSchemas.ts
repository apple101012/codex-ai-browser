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
  proxy: ProxySettingsSchema
});

export const UpdateProfileToolInputSchema = z.object({
  profileId: z.string().uuid(),
  name: z.string().optional(),
  engine: EngineSchema.optional(),
  userAgent: z.string().optional(),
  headless: z.boolean().optional(),
  proxy: ProxySettingsSchema
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
  getProfile: "Get profile details and running state."
};

