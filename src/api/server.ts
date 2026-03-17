import Fastify from "fastify";
import cors from "@fastify/cors";
import { ZodError } from "zod";
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

export interface AppDependencies {
  config: AppConfig;
  store: ProfileStore;
  runtime: BrowserRuntime;
}

const parseProfileId = (value: unknown): string => {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid profile id.");
  }
  return value.trim();
};

export const buildServer = ({ config, store, runtime }: AppDependencies) => {
  const app = Fastify({
    logger: true
  });

  app.register(cors, {
    origin: true
  });

  app.addHook("preHandler", authHook(config.apiToken));

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
    await reply.send({
      profileId: profile.id,
      total: results.length,
      successCount,
      results
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
