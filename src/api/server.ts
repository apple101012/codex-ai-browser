import Fastify from "fastify";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import os from "node:os";
import path from "node:path";
import { unlink, readFile } from "node:fs/promises";
import { resolve4 as dnsResolve4 } from "node:dns/promises";
import { z, ZodError } from "zod";
import type { FastifyReply } from "fastify";
import { authHook } from "./auth.js";
import {
  CreateProfileInputSchema,
  type ProfileRecord,
  UpdateProfileInputSchema
} from "../domain/profile.js";
import { type CommandExecutionResult, RunCommandsRequestSchema } from "../domain/commands.js";
import { applyBatchStateSkip } from "../domain/batchOptimize.js";
import type { ProfileStore } from "../storage/profileStore.js";
import type { BrowserRuntime } from "../browser/runtime.js";
import type { Cookie } from "playwright";
import type { AppConfig } from "../config.js";
import type { ActiveControlStore } from "../control/activeControlStore.js";
import { ProfileBackupStore } from "../storage/profileBackupStore.js";
import { createPlaywrightProxyChecker, type ProxyCheckResult } from "../proxy/proxyChecker.js";
import { parseProxyString } from "../proxy/proxyParser.js";
import { ProxyCheckRequestSchema, ProxyParseRequestSchema } from "../proxy/proxySchemas.js";
import type { ProxyConfigInput } from "../proxy/proxyTypes.js";
import { CommandLogStore } from "../storage/commandLogStore.js";
import { ScheduleStore, CreateScheduleInputSchema } from "../storage/scheduleStore.js";
import { ScheduleRunner } from "../scheduler/scheduleRunner.js";

export interface AppDependencies {
  config: AppConfig;
  store: ProfileStore;
  runtime: BrowserRuntime;
  controlStore: ActiveControlStore;
  backupStore?: ProfileBackupStore;
  proxyChecker?: ProxyCheckerFn;
  commandLogStore?: CommandLogStore;
  scheduleStore?: ScheduleStore;
  scheduleRunner?: ScheduleRunner;
}

type ProxyCheckerFn = (
  proxyInput: ProxyConfigInput,
  options?: { testUrl?: string; timeoutMs?: number }
) => Promise<ProxyCheckResult>;

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

const EnsureActiveProfileSchema = z.object({
  profileId: z.string().uuid().optional(),
  profileName: z.string().min(1).max(200).optional(),
  autoStart: z.boolean().default(true),
  setActive: z.boolean().default(true),
  preferRunningBrowserProfile: z.boolean().default(true),
  allowAnyRunningFallback: z.boolean().default(false)
});

const StartProfileSchema = z.object({
  setActive: z.boolean().default(false)
});

const SetProfileVisibilitySchema = z.object({
  visible: z.boolean(),
  autoStart: z.boolean().default(false),
  setActive: z.boolean().default(false)
});

const EnsureGeminiProfileSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().default(false),
  userAgent: z.string().min(3).max(800).optional()
});

const OpenGeminiSessionSchema = z.object({
  externalDataDir: z.string().min(1).optional(),
  forceUpdate: z.boolean().default(true),
  autoSetActive: z.boolean().default(true),
  targetUrl: z.string().url().default("https://gemini.google.com/")
});

const OpenUrlSchema = z.object({
  url: z.string().url(),
  profileId: z.string().uuid().optional(),
  autoSetActive: z.boolean().default(true),
  autoStart: z.boolean().default(true)
});

const CaptureActiveScreenshotSchema = z.object({
  tabIndex: z.number().int().min(0).optional(),
  fullPage: z.boolean().default(false),
  path: z.string().min(1).max(500).optional(),
  autoStart: z.boolean().default(true),
  autoDeleteAfterMs: z.number().int().min(0).max(86_400_000).default(0)
});

const DeleteArtifactSchema = z.object({
  path: z.string().min(1).max(500)
});

const CreateBackupSchema = z.object({
  destinationDir: z.string().min(1).optional(),
  label: z.string().min(1).max(200).optional()
});

const ListBackupsSchema = z.object({
  profileId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const ListProfileBackupsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100)
});

const RestoreBackupSchema = z.object({
  backupId: z.string().uuid(),
  autoStart: z.boolean().default(false),
  setActive: z.boolean().default(false)
});

const DEFAULT_BROWSER_PROFILE_NAME = "Browser Profile";
const LEGACY_GEMINI_PROFILE_NAME = "Gemini Persistent";

export const buildServer = ({
  config,
  store,
  runtime,
  controlStore,
  backupStore: providedBackupStore,
  proxyChecker: providedProxyChecker,
  commandLogStore: providedCommandLogStore,
  scheduleStore: providedScheduleStore,
  scheduleRunner: providedScheduleRunner
}: AppDependencies) => {
  const backupStore = providedBackupStore ?? new ProfileBackupStore(config.backupDir ?? path.join(config.dataDir, "backups"));
  const proxyChecker = providedProxyChecker ?? createPlaywrightProxyChecker({ headless: true });
  const commandLogStore = providedCommandLogStore ?? new CommandLogStore();
  const scheduleStoreCreatedHere = !providedScheduleStore;
  const scheduleStore = providedScheduleStore ?? new ScheduleStore(path.join(config.dataDir, "schedules"));
  const scheduleRunnerCreatedHere = !providedScheduleRunner;
  const scheduleRunner = providedScheduleRunner ?? new ScheduleRunner(scheduleStore, store, runtime, commandLogStore);
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

  // When scheduleStore/runner were created internally (not passed by caller),
  // initialize them before the server begins handling requests.
  if (scheduleStoreCreatedHere || scheduleRunnerCreatedHere) {
    app.addHook("onReady", async () => {
      if (scheduleStoreCreatedHere) await scheduleStore.init();
      if (scheduleRunnerCreatedHere) await scheduleRunner.bootAll();
    });
  }

  app.addHook("preHandler", authHook(config.apiToken));

  app.get("/app", async (_, reply) => {
    await reply.sendFile("index.html");
  });

  app.get("/proxy-checker", async (_, reply) => {
    await reply.sendFile("proxy-checker.html");
  });

  app.get("/", async (_, reply) => {
    await reply.redirect("/app");
  });

  app.get("/health", async () => ({
    ok: true,
    service: "codex-ai-browser",
    timestamp: new Date().toISOString()
  }));

  // ── Viewport sync ──────────────────────────────────────────────────────────
  const ViewportSchema = z.object({
    profileId: z.string().uuid(),
    width: z.number().int().min(100).max(7680),
    height: z.number().int().min(100).max(4320)
  });
  app.post("/viewport", async (request, reply) => {
    const { profileId, width, height } = ViewportSchema.parse(request.body ?? {});
    if (!runtime.isRunning(profileId)) {
      return reply.code(409).send({ error: "Profile is not running." });
    }
    await runtime.setViewportSize(profileId, width, height);
    return reply.send({ ok: true, profileId, width, height });
  });

  app.post("/proxy/parse", async (request, reply) => {
    const payload = ProxyParseRequestSchema.parse(request.body ?? {});
    const proxy = parseProxyString(payload.proxyInput);
    await reply.send({
      proxy: redactProxyForResponse(proxy),
      parsed: true
    });
  });

  app.post("/proxy/check", async (request, reply) => {
    const payload = ProxyCheckRequestSchema.parse(request.body ?? {});
    try { parseProxyString(payload.proxyInput); } catch (err) {
      await reply.code(400).send({ error: (err as Error).message ?? "Invalid proxy format." });
      return;
    }
    const result = await proxyChecker(payload.proxyInput, {
      testUrl: payload.testUrl,
      timeoutMs: payload.timeoutMs
    });
    await reply.send(redactProxyCheckResult(result));
  });

  app.post("/proxy/reputation", async (request, reply) => {
    const { ip } = z.object({ ip: z.string().regex(/^(25[0-5]|2[0-4]\d|[01]?\d\d?)(\.(25[0-5]|2[0-4]\d|[01]?\d\d?)){3}$/, "Invalid IPv4 address") }).parse(request.body ?? {});
    const [geo, fraudScore, spamhaus] = await Promise.allSettled([
      fetchGeoInfo(ip),
      fetchFraudScore(ip),
      checkSpamhaus(ip)
    ]);
    await reply.send({
      ip,
      geo: geo.status === "fulfilled" ? geo.value : { error: String((geo as PromiseRejectedResult).reason?.message ?? "failed") },
      scamalytics: fraudScore.status === "fulfilled" ? fraudScore.value : { error: String((fraudScore as PromiseRejectedResult).reason?.message ?? "failed") },
      spamhaus: spamhaus.status === "fulfilled" ? spamhaus.value : { error: String((spamhaus as PromiseRejectedResult).reason?.message ?? "failed") }
    });
  });

  app.get("/profiles", async () => {
    const controlState = await getReconciledControlState({ controlStore, runtime, store });
    const profiles = await store.list();
    return {
      profiles: profiles.map((profile) => redactProfileForResponse(profile)),
      runningProfileIds: controlState.runningProfileIds,
      activeProfileId: controlState.activeProfileId,
      controlUpdatedAt: controlState.updatedAt
    };
  });

  app.post("/profiles", async (request, reply) => {
    const payload = CreateProfileInputSchema.parse(request.body);
    const profile = await store.create(payload);
    await reply.code(201).send({ profile: redactProfileForResponse(profile) });
  });

  // ── Profile bulk import ────────────────────────────────────────────────────
  const BulkImportSchema = z.object({
    profiles: z.array(CreateProfileInputSchema).min(1).max(50)
  });

  app.post("/profiles/bulk-import", async (request, reply) => {
    const { profiles: inputs } = BulkImportSchema.parse(request.body);
    const created: ReturnType<typeof redactProfileForResponse>[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const input of inputs) {
      try {
        const profile = await store.create(input);
        created.push(redactProfileForResponse(profile));
      } catch (err: unknown) {
        errors.push({ name: input.name, error: String((err as Error)?.message ?? err) });
      }
    }
    return reply.code(201).send({ created, errors, total: inputs.length });
  });

  app.get("/backups", async (request, reply) => {
    const query = ListBackupsSchema.parse(request.query ?? {});
    const backups = await backupStore.listBackups({
      profileId: query.profileId,
      limit: query.limit
    });

    await reply.send({ backups });
  });

  app.get("/profiles/:id/backups", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    const profile = await store.get(id);
    if (!profile) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    const query = ListProfileBackupsSchema.parse(request.query ?? {});
    const backups = await backupStore.listBackups({
      profileId: id,
      limit: query.limit
    });

    await reply.send({ profileId: id, backups });
  });

  app.post("/profiles/:id/backup", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) {
      return;
    }

    const payload = CreateBackupSchema.parse(request.body ?? {});
    const backup = await backupStore.createBackup({
      profile,
      destinationDir: payload.destinationDir,
      label: payload.label
    });

    await reply.send({
      created: true,
      profileId: profile.id,
      backup
    });
  });

  app.post("/profiles/:id/restore", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    const profile = await store.get(id);
    if (!profile) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    const payload = RestoreBackupSchema.parse(request.body ?? {});
    const backup = await backupStore.getBackup(payload.backupId);
    if (!backup) {
      await reply.code(404).send({ error: "Backup not found." });
      return;
    }

    if (backup.profileId !== profile.id) {
      await reply.code(400).send({ error: "Backup does not belong to this profile." });
      return;
    }

    const wasRunning = runtime.isRunning(id);
    if (wasRunning) {
      await runtime.stop(id);
    }

    await backupStore.restoreBackup(profile, backup);

    const started = payload.autoStart || wasRunning;
    if (started) {
      await runtime.start(profile);
    }

    if (payload.setActive) {
      controlStore.setActiveProfile(id);
    }

    await reply.send({
      restored: true,
      profileId: id,
      backup,
      started,
      activeProfileId: payload.setActive ? id : controlStore.getState().activeProfileId
    });
  });

  app.post("/profiles/ensure/gemini", async (request, reply) => {
    const payload = EnsureGeminiProfileSchema.parse(request.body ?? {});
    const result = await ensureGeminiProfile(store, payload);

    await reply.send({
      created: result.created,
      profile: redactProfileForResponse(result.profile),
      geminiProfileDir: result.geminiProfileDir
    });
  });

  app.post("/profiles/ensure/browser", async (request, reply) => {
    const payload = EnsureGeminiProfileSchema.parse(request.body ?? {});
    const result = await ensureGeminiProfile(store, payload);

    await reply.send({
      created: result.created,
      profile: redactProfileForResponse(result.profile),
      browserProfileDir: result.geminiProfileDir
    });
  });

  app.post("/control/open-url", async (request, reply) => {
    const payload = OpenUrlSchema.parse(request.body ?? {});
    let profile = payload.profileId ? await store.get(payload.profileId) : null;
    if (!profile && controlStore.getState().activeProfileId) {
      profile = await store.get(controlStore.getState().activeProfileId as string);
    }

    if (!profile) {
      const managed = await ensureGeminiProfile(store, { forceUpdate: false });
      profile = managed.profile;
    }

    if (!profile) {
      await reply.code(500).send({ error: "Unable to resolve a browser profile." });
      return;
    }

    if (payload.autoStart && !runtime.isRunning(profile.id)) {
      await runtime.start(profile);
    }

    const commandResult = await runtime.execute(profile, {
      type: "navigate",
      url: payload.url
    });

    if (payload.autoSetActive) {
      controlStore.setActiveProfile(profile.id);
    }

    await reply.send({
      profile: redactProfileForResponse(profile),
      activeProfileId: payload.autoSetActive ? profile.id : controlStore.getState().activeProfileId,
      navigate: commandResult
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
      profile: redactProfileForResponse(gemini.profile),
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
      profile: redactProfileForResponse(profile),
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

    await reply.send({ profile: redactProfileForResponse(updated) });
  });

  app.delete("/profiles/:id", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    await runtime.stop(id);
    const deleted = await store.delete(id);
    if (!deleted) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    const state =
      controlStore.getState().activeProfileId === id ? controlStore.clearActiveProfile() : controlStore.getState();
    await reply.send({ deleted: true, activeProfileId: state.activeProfileId });
  });

  app.post("/profiles/:id/start", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) {
      return;
    }

    await runtime.start(profile);
    const payload = StartProfileSchema.parse(request.body ?? {});
    if (payload.setActive) {
      controlStore.setActiveProfile(profile.id);
    }
    await reply.send({
      started: true,
      profileId: profile.id,
      activeProfileId: payload.setActive ? profile.id : controlStore.getState().activeProfileId
    });
  });

  app.post("/profiles/:id/stop", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    await runtime.stop(id);
    const nextState =
      controlStore.getState().activeProfileId === id ? controlStore.clearActiveProfile() : controlStore.getState();
    await reply.send({
      stopped: true,
      profileId: id,
      activeProfileId: nextState.activeProfileId
    });
  });

  app.post("/profiles/:id/visibility", async (request, reply) => {
    const id = parseProfileId((request.params as { id?: string }).id);
    const payload = SetProfileVisibilitySchema.parse(request.body ?? {});
    const existing = await store.get(id);
    if (!existing) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    const updated = await store.update(id, {
      settings: {
        headless: !payload.visible
      }
    });
    if (!updated) {
      await reply.code(404).send({ error: "Profile not found." });
      return;
    }

    let restarted = false;
    let started = false;
    if (runtime.isRunning(id)) {
      await runtime.stop(id);
      await runtime.start(updated);
      restarted = true;
    } else if (payload.autoStart) {
      await runtime.start(updated);
      started = true;
    }

    if (payload.setActive) {
      controlStore.setActiveProfile(id);
    }

    await reply.send({
      profile: redactProfileForResponse(updated),
      visible: updated.settings.headless === false,
      restarted,
      started,
      activeProfileId: payload.setActive ? id : controlStore.getState().activeProfileId
    });
  });

  app.post("/profiles/stop-all", async (_, reply) => {
    const runningProfileIds = runtime.listRunningIds();
    await runtime.stopAll();
    const state = controlStore.clearActiveProfile();
    await reply.send({
      stopped: true,
      stoppedCount: runningProfileIds.length,
      stoppedProfileIds: runningProfileIds,
      activeProfileId: state.activeProfileId
    });
  });

  app.post("/profiles/:id/commands", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) {
      return;
    }

    const payload = RunCommandsRequestSchema.parse(request.body);
    const result = await executeCommandBatch({ profile, payload, runtime, commandLogStore });
    await reply.send({
      profileId: profile.id,
      ...result
    });
  });

  // ── Command log ────────────────────────────────────────────────────────────
  const CommandLogQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(1000).default(100) });

  app.get("/profiles/:id/command-log", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) return;
    const query = CommandLogQuerySchema.parse(request.query);
    const entries = await commandLogStore.readLast(profile.dataDir, query.limit);
    return reply.send({ profileId: profile.id, entries });
  });

  // ── Cookie import/export ───────────────────────────────────────────────────
  const CookiesQuerySchema = z.object({ urls: z.string().optional() });
  const CookieSchema = z.object({
    name: z.string(),
    value: z.string(),
    domain: z.string().optional(),
    url: z.string().url().optional(),
    path: z.string().optional(),
    expires: z.number().min(-1).optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.enum(["Strict", "Lax", "None"]).optional()
  }).refine(c => c.domain !== undefined || c.url !== undefined, {
    message: "Each cookie must have either 'domain' or 'url'"
  });
  const AddCookiesBodySchema = z.object({ cookies: z.array(CookieSchema).min(1) });

  app.get("/profiles/:id/cookies", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) return;
    if (!runtime.isRunning(profile.id)) {
      return reply.code(409).send({ error: "Profile is not running. Start it first." });
    }
    const { urls: rawUrls } = CookiesQuerySchema.parse(request.query);
    const urls = rawUrls ? rawUrls.split(",").map((u) => decodeURIComponent(u.trim())).filter(Boolean) : undefined;
    let cookies;
    try {
      cookies = await runtime.getCookies(profile.id, urls);
    } catch (err: any) {
      return reply.code(422).send({ error: "Failed to read cookies", detail: String(err?.message ?? err) });
    }
    return reply.send({ profileId: profile.id, cookies });
  });

  app.post("/profiles/:id/cookies", async (request, reply) => {
    const profile = await getProfileOr404(request.params, store, reply);
    if (!profile) return;
    if (!runtime.isRunning(profile.id)) {
      return reply.code(409).send({ error: "Profile is not running. Start it first." });
    }
    const { cookies } = AddCookiesBodySchema.parse(request.body);
    try {
      await runtime.addCookies(profile.id, cookies as Cookie[]);
    } catch (err: any) {
      return reply.code(422).send({ error: "Failed to add cookies", detail: String(err?.message ?? err) });
    }
    return reply.code(200).send({ added: true, count: cookies.length });
  });

  // ── Scheduled tasks ────────────────────────────────────────────────────────
  app.post("/schedules", async (request, reply) => {
    const input = CreateScheduleInputSchema.parse(request.body);
    // Verify profile exists
    const profile = await store.get(input.profileId);
    if (!profile) return reply.code(404).send({ error: "Profile not found." });
    const schedule = await scheduleStore.create(input);
    if (schedule.enabled) scheduleRunner.register(schedule.id, schedule.intervalMs);
    return reply.code(201).send({ schedule });
  });

  app.get("/schedules", async (_request, reply) => {
    const schedules = await scheduleStore.list();
    return reply.send({ schedules });
  });

  app.get("/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await scheduleStore.get(id);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found." });
    return reply.send({ schedule });
  });

  app.delete("/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    scheduleRunner.unregister(id);
    const deleted = await scheduleStore.delete(id);
    if (!deleted) return reply.code(404).send({ error: "Schedule not found." });
    return reply.send({ deleted: true });
  });

  app.post("/schedules/:id/run", async (request, reply) => {
    const { id } = request.params as { id: string };
    const schedule = await scheduleStore.get(id);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found." });
    const wasAlreadyRunning = scheduleRunner.isRunning(id);
    await scheduleRunner.runSchedule(id);
    const updated = await scheduleStore.get(id);
    if (wasAlreadyRunning) {
      return reply.send({ ran: false, reason: "already_running", schedule: updated });
    }
    return reply.send({ ran: true, schedule: updated });
  });

  const PatchScheduleBodySchema = z.object({
    enabled: z.boolean().optional(),
    label: z.string().max(200).nullable().optional()
  }).refine(b => b.enabled !== undefined || b.label !== undefined, {
    message: "Provide at least one of 'enabled' or 'label'"
  });

  app.patch("/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = PatchScheduleBodySchema.parse(request.body);
    const schedule = await scheduleStore.get(id);
    if (!schedule) return reply.code(404).send({ error: "Schedule not found." });
    if (body.enabled !== undefined) {
      await scheduleStore.setEnabled(id, body.enabled);
      if (body.enabled) {
        scheduleRunner.register(id, schedule.intervalMs);
      } else {
        scheduleRunner.unregister(id);
      }
    }
    if (body.label !== undefined) {
      await scheduleStore.setLabel(id, body.label ?? undefined);
    }
    const updated = await scheduleStore.get(id);
    return reply.send({ schedule: updated });
  });

  app.get("/control/state", async () => {
    return await getReconciledControlState({ controlStore, runtime, store });
  });

  app.post("/control/ensure-active", async (request, reply) => {
    const payload = EnsureActiveProfileSchema.parse(request.body ?? {});
    const state = await getReconciledControlState({ controlStore, runtime, store });
    const runningIds = new Set(state.runningProfileIds);
    const profiles = await store.list();

    let profile: ProfileRecord | null = null;
    let resolution: "explicit-profile-id" | "explicit-profile-name" | "existing-active" | "running-browser-profile" | "any-running" | "none" = "none";

    if (payload.profileId) {
      profile = await store.get(payload.profileId);
      resolution = "explicit-profile-id";
    } else if (payload.profileName) {
      profile = await store.findByName(payload.profileName);
      resolution = "explicit-profile-name";
    } else if (state.activeProfileId) {
      profile = await store.get(state.activeProfileId);
      resolution = "existing-active";
    }

    if (!profile && payload.preferRunningBrowserProfile) {
      profile =
        profiles.find((candidate) => candidate.name.toLowerCase() === DEFAULT_BROWSER_PROFILE_NAME.toLowerCase() && runningIds.has(candidate.id)) ??
        null;
      if (profile) {
        resolution = "running-browser-profile";
      }
    }

    if (!profile && payload.allowAnyRunningFallback) {
      const runningProfiles = profiles
        .filter((candidate) => runningIds.has(candidate.id))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      profile = runningProfiles[0] ?? null;
      if (profile) {
        resolution = "any-running";
      }
    }

    if (!profile) {
      await reply.code(404).send({
        error:
          "No profile could be resolved. Provide profileId/profileName, or set allowAnyRunningFallback=true."
      });
      return;
    }

    const wasRunning = runtime.isRunning(profile.id);
    if (payload.autoStart && !wasRunning) {
      await runtime.start(profile);
    }

    const currentState = payload.setActive ? controlStore.setActiveProfile(profile.id) : controlStore.getState();
    await reply.send({
      profile: redactProfileForResponse(profile),
      resolvedFrom: resolution,
      started: payload.autoStart && !wasRunning,
      running: runtime.isRunning(profile.id),
      activeProfileId: currentState.activeProfileId,
      updatedAt: currentState.updatedAt
    });
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
    const state = await getReconciledControlState({ controlStore, runtime, store });
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
    const result = await executeCommandBatch({ profile, payload, runtime, commandLogStore });
    await reply.send({
      profileId: profile.id,
      activeProfileId: profile.id,
      ...result
    });
  });

  app.post("/control/active/screenshot", async (request, reply) => {
    const state = await getReconciledControlState({ controlStore, runtime, store });
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

    const payload = CaptureActiveScreenshotSchema.parse(request.body ?? {});
    if (payload.autoStart && !runtime.isRunning(profile.id)) {
      await runtime.start(profile);
    }

    const result = await runtime.execute(profile, {
      type: "screenshot",
      tabIndex: payload.tabIndex,
      fullPage: payload.fullPage,
      path: payload.path
    });

    const artifactPath = getResultScreenshotPath(result);
    const hasArtifactPath = typeof artifactPath === "string" && artifactPath.length > 0;
    const deleteScheduled = Boolean(hasArtifactPath && payload.autoDeleteAfterMs > 0);
    const deleteAt =
      deleteScheduled && payload.autoDeleteAfterMs > 0
        ? new Date(Date.now() + payload.autoDeleteAfterMs).toISOString()
        : null;

    if (deleteScheduled && artifactPath) {
      scheduleArtifactDeletion(artifactPath, payload.autoDeleteAfterMs);
    }

    await reply.send({
      profileId: profile.id,
      activeProfileId: profile.id,
      screenshot: result,
      artifactPath: artifactPath ?? null,
      deleteScheduled,
      autoDeleteAfterMs: payload.autoDeleteAfterMs,
      deleteAt
    });
  });

  app.get("/artifacts", async (request, reply) => {
    const { path: artifactPath } = request.query as { path?: string };
    if (!artifactPath) {
      await reply.code(400).send({ error: "path query param is required." });
      return;
    }
    const resolvedPath = resolveArtifactPath(config.artifactsDir, artifactPath);
    let data: Buffer;
    try {
      data = await readFile(resolvedPath);
    } catch {
      await reply.code(404).send({ error: "Artifact not found." });
      return;
    }
    const ext = resolvedPath.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp" };
    const mime = mimeMap[ext] ?? "application/octet-stream";
    await reply.header("content-type", mime).send(data);
  });

  app.post("/artifacts/delete", async (request, reply) => {
    const payload = DeleteArtifactSchema.parse(request.body ?? {});
    const resolvedPath = resolveArtifactPath(config.artifactsDir, payload.path);
    const deleted = await deleteArtifactFile(resolvedPath);
    await reply.send({
      deleted,
      path: resolvedPath
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

const getReconciledControlState = async ({
  controlStore,
  runtime,
  store
}: {
  controlStore: ActiveControlStore;
  runtime: BrowserRuntime;
  store: ProfileStore;
}): Promise<{
  activeProfileId: string | null;
  updatedAt: string;
  runningProfileIds: string[];
  staleActiveProfileId: string | null;
}> => {
  const runningProfileIds = runtime.listRunningIds();
  const runningSet = new Set(runningProfileIds);
  const state = controlStore.getState();
  const activeProfileId = state.activeProfileId;
  if (!activeProfileId) {
    return {
      ...state,
      runningProfileIds,
      staleActiveProfileId: null
    };
  }

  const profile = await store.get(activeProfileId);
  const isRunning = runningSet.has(activeProfileId);
  if (!profile || !isRunning) {
    const cleared = controlStore.clearActiveProfile();
    return {
      ...cleared,
      runningProfileIds,
      staleActiveProfileId: activeProfileId
    };
  }

  return {
    ...state,
    runningProfileIds,
    staleActiveProfileId: null
  };
};

const executeCommandBatch = async ({
  profile,
  payload,
  runtime,
  commandLogStore
}: {
  profile: ProfileRecord;
  payload: z.infer<typeof RunCommandsRequestSchema>;
  runtime: BrowserRuntime;
  commandLogStore?: CommandLogStore;
}) => {
  if (payload.autoStart && !runtime.isRunning(profile.id)) {
    await runtime.start(profile);
  }

  const startTime = Date.now();
  const results: CommandExecutionResult[] = [];
  const optimizedCommands = applyBatchStateSkip(payload.commands);
  for (const command of optimizedCommands) {
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

  const durationMs = Date.now() - startTime;
  if (commandLogStore) {
    commandLogStore
      .append(profile.dataDir, {
        ts: new Date().toISOString(),
        commands: payload.commands,
        durationMs,
        results
      })
      .catch((err) => console.warn("[command-log] write failed:", err));
  }

  const successCount = results.filter((result) => result.ok).length;
  return {
    total: results.length,
    successCount,
    results
  };
};

const getResultScreenshotPath = (result: { data?: unknown }): string | null => {
  if (!result || typeof result !== "object") {
    return null;
  }
  const candidate = (result.data as { path?: unknown } | undefined)?.path;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
};

const redactProxyForResponse = (
  proxy: { server: string; username?: string; password?: string } | null | undefined
): { server: string; hasAuth: boolean } | undefined => {
  if (!proxy) {
    return undefined;
  }
  const redactedServer = stripProxyCredentials(proxy.server);
  return {
    server: redactedServer,
    hasAuth: Boolean(proxy.username || proxy.password || redactedServer !== proxy.server)
  };
};

const redactSensitiveText = (value: string): string => {
  return value
    .replace(
      /([a-z][a-z0-9+.-]*:\/\/)([^:@/\s]+):([^@/\s]+)@/gi,
      "$1[redacted-user]:[redacted-pass]@"
    )
    .replace(/\b([a-z0-9.-]+:\d+):([^:\s]+):([^:\s]+)\b/gi, "$1:[redacted-user]:[redacted-pass]")
    .replace(/(password|passwd|pwd)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/(username|user)=([^&\s]+)/gi, "$1=[redacted]");
};

const redactProxyCheckResult = (result: ProxyCheckResult): Omit<ProxyCheckResult, "proxy"> & {
  proxy: { server: string; hasAuth: boolean } | undefined;
} => {
  const redactAttemptField = (value: string | undefined): string | undefined =>
    typeof value === "string" ? redactSensitiveText(value) : undefined;

  return {
    ...result,
    proxy: redactProxyForResponse(result.proxy),
    error: redactAttemptField(result.error),
    bodySnippet: redactAttemptField(result.bodySnippet),
    attempts: result.attempts.map((attempt) => ({
      ...attempt,
      error: redactAttemptField(attempt.error),
      bodySnippet: redactAttemptField(attempt.bodySnippet)
    }))
  };
};

const redactProfileForResponse = (
  profile: ProfileRecord | null
):
  | (Omit<ProfileRecord, "settings"> & {
      settings: Omit<ProfileRecord["settings"], "proxy"> & { proxy?: { server: string; hasAuth: boolean } };
    })
  | null => {
  if (!profile) {
    return null;
  }

  return {
    ...profile,
    settings: {
      ...profile.settings,
      proxy: redactProxyForResponse(profile.settings.proxy)
    }
  };
};

const fetchGeoInfo = async (ip: string): Promise<{
  country: string; region: string; city: string; isp: string; org: string;
}> => {
  const res = await fetch(
    `https://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,regionName,city,isp,org`,
    { signal: AbortSignal.timeout(8_000) }
  );
  const data = await res.json() as { status: string; message?: string; country?: string; regionName?: string; city?: string; isp?: string; org?: string };
  if (data.status !== "success") throw new Error(data.message ?? "Geo lookup failed");
  return { country: data.country ?? "", region: data.regionName ?? "", city: data.city ?? "", isp: data.isp ?? "", org: data.org ?? "" };
};

const fetchFraudScore = async (ip: string): Promise<{
  score: number | null; risk: string | null; type: string | null; url: string;
}> => {
  const url = `https://proxycheck.io/`;
  const res = await fetch(
    `https://proxycheck.io/v2/${encodeURIComponent(ip)}?vpn=1&risk=1`,
    { signal: AbortSignal.timeout(10_000) }
  );
  const data = await res.json() as Record<string, unknown>;
  if (data["status"] !== "ok") throw new Error("proxycheck.io lookup failed");
  const ipData = data[ip] as Record<string, unknown> | undefined;
  if (!ipData) throw new Error("No data returned for IP");
  const rawRisk = ipData["risk"];
  const score = typeof rawRisk === "number" ? rawRisk :
                typeof rawRisk === "string" ? parseInt(rawRisk, 10) : null;
  let risk: string | null = null;
  if (score !== null && !isNaN(score)) {
    if (score >= 75) risk = "very high";
    else if (score >= 50) risk = "high";
    else if (score >= 25) risk = "medium";
    else risk = "low";
  }
  const type = typeof ipData["type"] === "string" ? ipData["type"] : null;
  return { score: (score !== null && !isNaN(score)) ? score : null, risk, type, url };
};

const checkSpamhaus = async (ip: string): Promise<{
  listed: boolean; codes: string[];
}> => {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error("IPv4 required for Spamhaus lookup");
  const reversed = parts.slice().reverse().join(".");
  try {
    const addresses = await dnsResolve4(`${reversed}.zen.spamhaus.org`);
    const codes = addresses.map((addr) => {
      if (addr === "127.0.0.2") return "SBL";
      if (addr === "127.0.0.4") return "XBL";
      if (addr === "127.0.0.9") return "SBL+CSS";
      if (addr === "127.0.0.10" || addr === "127.0.0.11") return "PBL";
      return addr;
    });
    return { listed: true, codes };
  } catch {
    return { listed: false, codes: [] };
  }
};

const stripProxyCredentials = (server: string): string => {
  const trimmed = server.trim();
  if (!trimmed) {
    return server;
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed);
  const candidate = hasScheme ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(candidate);
    if (!parsed.username && !parsed.password) {
      return trimmed;
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return trimmed.replace(/^([^@/]+):([^@/]+)@/, "");
  }
};

const resolveArtifactPath = (artifactsDir: string, requestedPath: string): string => {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Artifact path is required.");
  }

  const artifactsRoot = path.resolve(artifactsDir);
  const resolved = path.resolve(path.isAbsolute(trimmed) ? trimmed : path.join(artifactsRoot, trimmed));
  const normalizedRoot = artifactsRoot.toLowerCase();
  const normalizedResolved = resolved.toLowerCase();
  const inRoot =
    normalizedResolved === normalizedRoot || normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`);

  if (!inRoot) {
    throw new Error("Artifact path must stay inside artifacts directory.");
  }

  return resolved;
};

const deleteArtifactFile = async (resolvedPath: string): Promise<boolean> => {
  try {
    await unlink(resolvedPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const scheduleArtifactDeletion = (resolvedPath: string, autoDeleteAfterMs: number): void => {
  if (autoDeleteAfterMs <= 0) {
    return;
  }
  setTimeout(() => {
    void deleteArtifactFile(resolvedPath);
  }, autoDeleteAfterMs).unref();
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

  const existingByDefaultName = await store.findByName(DEFAULT_BROWSER_PROFILE_NAME);
  const existingByLegacyName = existingByDefaultName ? null : await store.findByName(LEGACY_GEMINI_PROFILE_NAME);
  const existing = existingByDefaultName ?? existingByLegacyName;
  let profile: ProfileRecord | null = existing;
  let created = false;

  if (!existing) {
    profile = await store.create({
      name: DEFAULT_BROWSER_PROFILE_NAME,
      engine: "chrome",
      externalDataDir: geminiDir,
      settings: {
        headless: false,
        userAgent: payload.userAgent
      }
    });
    created = true;
  } else if (payload.forceUpdate || existing.dataDir !== geminiDir || payload.userAgent !== undefined) {
    const nextUserAgent = payload.userAgent ?? (payload.forceUpdate ? undefined : existing.settings.userAgent);
    profile = await store.update(existing.id, {
      name: DEFAULT_BROWSER_PROFILE_NAME,
      engine: "chrome",
      externalDataDir: geminiDir,
      settings: {
        headless: false,
        userAgent: nextUserAgent
      }
    });
  } else if (existing.name !== DEFAULT_BROWSER_PROFILE_NAME) {
    profile = await store.update(existing.id, { name: DEFAULT_BROWSER_PROFILE_NAME });
  }

  return {
    created,
    profile,
    geminiProfileDir: geminiDir
  };
};
