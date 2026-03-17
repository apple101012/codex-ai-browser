import { z } from "zod";
import {
  BackupProfileToolInputSchema,
  CreateProfileToolInputSchema,
  EnsureGeminiProfileToolInputSchema,
  ListBackupsToolInputSchema,
  OpenGeminiSessionToolInputSchema,
  ProfileIdToolInputSchema,
  RestoreProfileBackupToolInputSchema,
  RunActiveCommandsToolInputSchema,
  RunCommandsToolInputSchema,
  SetActiveProfileToolInputSchema,
  ToolDescriptions,
  UpdateProfileToolInputSchema
} from "./toolSchemas.js";

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
    "run_active_commands",
    {
      description: ToolDescriptions.runActiveCommands,
      inputSchema: {
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
      }
    },
    async (input) => {
      const parsed = RunActiveCommandsToolInputSchema.parse(input);
      const payload = await apiRequest("/control/active/commands", {
        method: "POST",
        body: JSON.stringify({
          autoStart: parsed.autoStart ?? true,
          commands: parsed.commands
        })
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
      }
    },
    async (input) => {
      const parsed = RunCommandsToolInputSchema.parse(input);
      const payload = await apiRequest(`/profiles/${parsed.profileId}/commands`, {
        method: "POST",
        body: JSON.stringify({
          commands: parsed.commands,
          autoStart: parsed.autoStart ?? true
        })
      });
      return toText(payload);
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
};
