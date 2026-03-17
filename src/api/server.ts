import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import os from "node:os";
import path from "node:path";
import { z, ZodError } from "zod";
import type { FastifyReply } from "fastify";
import { authHook } from "./auth.js";
import {
  CreateProfileInputSchema,
  type ProfileRecord,
  UpdateProfileInputSchema
} from "../domain/profile.js";
import { RunCommandsRequestSchema } from "../domain/commands.js";
import type { ProfileStore } from "../storage/profileStore.js";
import type { BrowserRuntime } from "../browser/runtime.js";
import type { AppConfig } from "../config.js";
import type { ActiveControlStore } from "../control/activeControlStore.js";

export interface AppDependencies {
  config: AppConfig;
  store: ProfileStore;
  runtime: BrowserRuntime;
  controlStore: ActiveControlStore;
}

const parseProfileId = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid profile id.");
  }
  return value.trim();
};

const SetActiveProfileSchema = z.object({
  profileId: z.string().uuid(),
  autoStart: z.boolean().default(true)
});

const EnsureGeminiProfileSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().default(false),
  userAgent: z.string().min(3).max(800).optional()
});

const OpenGeminiSessionSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().default(false),
  autoSetActive: z.boolean().default(true),
  targetUrl: z.string().url().default("https://gemini.google.com/")
});

const GEMINI_PROFILE_NAME = "Gemini Persistent";
const DEFAULT_GEMINI_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

export const buildServer = ({ config, store, runtime, controlStore }: AppDependencies) => {
  const app = Fastify({
    logger: true
  });

  app.register(cors, {
    origin: true
  });

  app.register(staticPlugin, {
    root: config.publicDir,
    prefix: "/app/"
  });

  app.addHook("preHandler", authHook(config.apiToken));

  app.get("/app", async (_, reply) => {
    await reply.sendFile("index.html");
  });

  app.get("/health", async () => ({
    ok: true,
    service: "codex-ai-browser",
    timestamp: new Date().toISOString()
  }));

  app.get("/profiles", async () => {
    const profiles = await store.list();
    return {
      profiles,
      runningProfileIds: runtime.listRunningIds()
    };
  });

  app.post("/profiles", async (request, reply) => {
    const payload = CreateProfileInputSchema.parse(request.body);
    const profile = await store.create(payload);
    await reply.code(201).send({ profile });
  });

  app.post("/profiles/ensure/gemini", async (request, reply) => {
    const payload = EnsureGeminiProfileSchema.parse(request.body ?? {});
    const result = await ensureGeminiProfile(store, payload);

    await reply.send({
      created: result.created,
      profile: result.profile,
      geminiProfileDir: result.geminiProfileDir
    });
  });

  app.post("/control/open-gemini", async (request, reply) => {
    const payload = OpenGeminiSessionSchema.parse(request.body ?? {});
    const gemini = await ensureGeminiProfile(store, payload);
    if (!gemini.profile) {
      await reply.code(500).send({ error: "Failed to create Gemini profile." });
      return;
    }

    if (!runtime.isRunning(gemini.profile.id)) {
      await runtime.start(gemini.profile);
    }

    const commandResult = await runtime.execute(gemini.profile, {
      type: "navigate",
      url: payload.targetUrl
    });

    if (payload.autoSetActive) {
      controlStore.setActiveProfile(gemini.profile.id);
    }

    await reply.send({
      profile: gemini.profile,
      created: gemini.created,
      activeProfileId: payload.autoSetActive ? gemini.profile.id : controlStore.getState().activeProfileId,
      navigate: commandResult
    });
  });

  app.get("/profiles/:id", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    const profile = await store.get(id);
    if (!profile) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    await reply.send({
      profile,
      running: runtime.isRunning(id)
    });
  });

  app.patch("/profiles/:id", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    const payload = UpdateProfileInputSchema.parse(request.body);
    const updated = await store.update(id, payload);
    if (!updated) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    if (runtime.isRunning(id)) {
      await runtime.stop(id);
      await runtime.start(updated);
    }

    await reply.send({ profile: updated });
  });

  app.delete("/profiles/:id", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    await runtime.stop(id);
    const deleted = await store.delete(id);
    if (!deleted) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    await reply.send({ deleted: true });
  });

  app.post("/profiles/:id/start", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) {
      return;
    }

    await runtime.start(profile);
    await reply.send({ started: true, profileId: profile.id });
  });

  app.post("/profiles/:id/stop", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    await runtime.stop(id);
    await reply.send({ stopped: true, profileId: id });
  });

  app.post("/profiles/:id/commands", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) {
      return;
    }

    const payload = RunCommandsRequestSchema.parse(request.body);
    const result = await executeCommandBatch({ profile, payload, runtime });
    await reply.send({
      profileId: profile.id,
      ...result
    });
  });

  app.get("/control/state", async () => {
    const state = controlStore.getState();
    return {
      ...state,
      runningProfileIds: runtime.listRunningIds()
    };
  });

  app.post("/control/active-profile", async (request, reply) => {
    const payload = SetActiveProfileSchema.parse(request.body);
    const profile = await store.get(payload.profileId);
    if (!profile) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    if (payload.autoStart && !runtime.isRunning(profile.id)) {
      await runtime.start(profile);
    }

    const state = controlStore.setActiveProfile(profile.id);
    await reply.send({
      activeProfileId: state.activeProfileId,
      updatedAt: state.updatedAt
    });
  });

  app.post("/control/release", async (_, reply) => {
    const state = controlStore.clearActiveProfile();
    await reply.send({
      activeProfileId: state.activeProfileId,
      updatedAt: state.updatedAt
    });
  });

  app.post("/control/active/commands", async (request, reply) => {
    const state = controlStore.getState();
    if (!state.activeProfileId) {
      await reply.code(400).send({ error: "No active profile selected." });
      return;
    }

    const profile = await store.get(state.activeProfileId);
    if (!profile) {
      controlStore.clearActiveProfile();
      await reply.code(404).send({ error: "Active profile no longer exists." });
      return;
    }

    const payload = RunCommandsRequestSchema.parse(request.body);
    const result = await executeCommandBatch({ profile, payload, runtime });
    await reply.send({
      profileId: profile.id,
      activeProfileId: profile.id,
      ...result
    });
  });

  app.setErrorHandler(async (error, _, reply) => {
    if (error instanceof ZodError) {
      await reply.code(400).send({
        error: "Validation error.",
        issues: error.issues
      });
      return;
    }

    requestScopedLog(app, error);
    await reply.code(500).send({ error: "Internal server error." });
  });

  return app;
};

const getProfileOr404 = async (
  params: unknown,
  store: ProfileStore,
  reply: FastifyReply
): Promise<ProfileRecord | null> => {
  const id = parseProfileId((params as { id?: string }).id);
  const profile = await store.get(id);
  if (!profile) {
    reply.code(404).send({ error: "Profile not found." });
    return null;
  }
  return profile;
};

const requestScopedLog = (app: { log: { error: (message: unknown) => void } }, error: unknown) => {
  app.log.error(error);
};

const executeCommandBatch = async ({
  profile,
  payload,
  runtime
}: {
  profile: ProfileRecord;
  payload: z.infer<typeof RunCommandsRequestSchema>;
  runtime: BrowserRuntime;
}) => {
  if (payload.autoStart && !runtime.isRunning(profile.id)) {
    await runtime.start(profile);
  }

  const results = [];
  for (const command of payload.commands) {
    try {
      const result = await runtime.execute(profile, command);
      results.push(result);
    } catch (error: unknown) {
      results.push({
        type: command.type,
        ok: false,
        error: error instanceof Error ? error.message : "Unknown command error."
      });
    }
  }

  const successCount = results.filter((result) => result.ok).length;
  return {
    total: results.length,
    successCount,
    results
  };
};

const ensureGeminiProfile = async (
  store: ProfileStore,
  payload: {
    externalDataDir?: string;
    forceUpdate?: boolean;
    userAgent?: string;
  }
): Promise<{ created: boolean; profile: ProfileRecord | null; geminiProfileDir: string }> => {
  const geminiDir = path.resolve(
    payload.externalDataDir ?? path.join(os.homedir(), ".codex", "playwright-profiles", "gemini")
  );

  const existing = await store.findByName(GEMINI_PROFILE_NAME);
  let profile: ProfileRecord | null = existing;
  let created = false;

  if (!existing) {
    profile = await store.create({
      name: GEMINI_PROFILE_NAME,
      engine: "chromium",
      externalDataDir: geminiDir,
      settings: {
        headless: false,
        userAgent: payload.userAgent ?? DEFAULT_GEMINI_USER_AGENT
      }
    });
    created = true;
  } else if (payload.forceUpdate || existing.dataDir !== geminiDir) {
    profile = await store.update(existing.id, {
      engine: "chromium",
      externalDataDir: geminiDir,
      settings: {
        headless: false,
        userAgent: payload.userAgent ?? existing.settings.userAgent ?? DEFAULT_GEMINI_USER_AGENT
      }
    });
  }

  return {
    created,
    profile,
    geminiProfileDir: geminiDir
  };
};
