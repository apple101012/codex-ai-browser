import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { apiRequest } from "./mcp/apiClient.js";
import {
  CreateProfileToolInputSchema,
  ProfileIdToolInputSchema,
  RunCommandsToolInputSchema,
  ToolDescriptions,
  UpdateProfileToolInputSchema
} from "./mcp/toolSchemas.js";

const toText = (value: unknown): { content: [{ type: "text"; text: string }] } => ({
  content: [{ type: "text", text: JSON.stringify(value, null, 2) }]
});

const server = new McpServer({
  name: "codex-ai-browser",
  version: "0.1.0"
});

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
      engine: z.enum(["chromium", "firefox"]).optional(),
      userAgent: z.string().optional(),
      headless: z.boolean().optional(),
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
        engine: parsed.engine ?? "chromium",
        settings: {
          userAgent: parsed.userAgent,
          headless: parsed.headless,
          proxy: parsed.proxy
        }
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
      engine: z.enum(["chromium", "firefox"]).optional(),
      userAgent: z.string().optional(),
      headless: z.boolean().optional(),
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
        }
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

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport();
  await server.connect(transport);
};

main().catch((error) => {
  console.error("MCP server failed:", error);
  process.exit(1);
});

