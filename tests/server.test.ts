import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { buildServer } from "../src/api/server.js";
import { ProfileStore } from "../src/storage/profileStore.js";
import { InMemoryRuntime } from "../src/browser/inMemoryRuntime.js";
import { createTempDir, removeDir } from "./testUtils.js";
import type { AppConfig } from "../src/config.js";
import { ActiveControlStore } from "../src/control/activeControlStore.js";

describe("HTTP API", () => {
  let tempDir: string;
  let store: ProfileStore;
  let runtime: InMemoryRuntime;
  let app: ReturnType<typeof buildServer>;
  let controlStore: ActiveControlStore;

  beforeEach(async () => {
    tempDir = await createTempDir("server-test-");
    store = new ProfileStore(path.join(tempDir, "profiles"));
    await store.init();
    runtime = new InMemoryRuntime();
    controlStore = new ActiveControlStore();

    const config: AppConfig = {
      host: "127.0.0.1",
      port: 4321,
      dataDir: tempDir,
      profilesDir: path.join(tempDir, "profiles"),
      artifactsDir: path.join(tempDir, "artifacts"),
      publicDir: path.join(process.cwd(), "public"),
      defaultHeadless: true,
      allowEvaluate: false,
      apiToken: "test-token"
    };

    app = buildServer({ config, store, runtime, controlStore });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await removeDir(tempDir);
  });

  it("enforces bearer token when configured", async () => {
    const response = await app.inject({
      method: "GET",
      path: "/profiles"
    });

    expect(response.statusCode).toBe(401);
  });

  it("serves the control UI without auth", async () => {
    const response = await app.inject({
      method: "GET",
      path: "/app"
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Codex AI Browser Control");
  });

  it("creates profiles and executes commands", async () => {
    const create = await app.inject({
      method: "POST",
      path: "/profiles",
      headers: { authorization: "Bearer test-token" },
      payload: {
        name: "API test profile",
        engine: "chromium",
        settings: {
          userAgent: "UA/Test"
        }
      }
    });

    expect(create.statusCode).toBe(201);
    const created = create.json<{ profile: { id: string; settings: { userAgent?: string } } }>();
    expect(created.profile.settings.userAgent).toBe("UA/Test");

    const run = await app.inject({
      method: "POST",
      path: `/profiles/${created.profile.id}/commands`,
      headers: { authorization: "Bearer test-token" },
      payload: {
        commands: [{ type: "getPageState", includeTextExcerpt: true }]
      }
    });

    expect(run.statusCode).toBe(200);
    const runPayload = run.json<{ successCount: number; total: number }>();
    expect(runPayload.total).toBe(1);
    expect(runPayload.successCount).toBe(1);
  });

  it("updates user agent settings", async () => {
    const create = await app.inject({
      method: "POST",
      path: "/profiles",
      headers: { authorization: "Bearer test-token" },
      payload: {
        name: "Patch profile",
        engine: "chromium",
        settings: {}
      }
    });
    const created = create.json<{ profile: { id: string } }>();

    const update = await app.inject({
      method: "PATCH",
      path: `/profiles/${created.profile.id}`,
      headers: { authorization: "Bearer test-token" },
      payload: {
        settings: {
          userAgent: "Spoofed/5.0"
        }
      }
    });

    expect(update.statusCode).toBe(200);
    const payload = update.json<{ profile: { settings: { userAgent?: string } } }>();
    expect(payload.profile.settings.userAgent).toBe("Spoofed/5.0");
  });

  it("supports active-profile takeover control", async () => {
    const create = await app.inject({
      method: "POST",
      path: "/profiles",
      headers: { authorization: "Bearer test-token" },
      payload: {
        name: "Takeover profile",
        engine: "chromium",
        settings: {}
      }
    });
    const created = create.json<{ profile: { id: string } }>();

    const setActive = await app.inject({
      method: "POST",
      path: "/control/active-profile",
      headers: { authorization: "Bearer test-token" },
      payload: {
        profileId: created.profile.id,
        autoStart: true
      }
    });
    expect(setActive.statusCode).toBe(200);

    const run = await app.inject({
      method: "POST",
      path: "/control/active/commands",
      headers: { authorization: "Bearer test-token" },
      payload: {
        commands: [{ type: "getPageState", includeTextExcerpt: true }]
      }
    });
    expect(run.statusCode).toBe(200);
    const payload = run.json<{ activeProfileId: string; successCount: number }>();
    expect(payload.activeProfileId).toBe(created.profile.id);
    expect(payload.successCount).toBe(1);
  });

  it("creates gemini profile preset", async () => {
    const ensure = await app.inject({
      method: "POST",
      path: "/profiles/ensure/gemini",
      headers: { authorization: "Bearer test-token" },
      payload: {}
    });
    expect(ensure.statusCode).toBe(200);
    const payload = ensure.json<{ profile?: { name: string; managedDataDir: boolean } }>();
    expect(payload.profile?.name).toBe("Gemini Persistent");
    expect(payload.profile?.managedDataDir).toBe(false);
  });

  it("opens gemini and sets takeover active", async () => {
    const open = await app.inject({
      method: "POST",
      path: "/control/open-gemini",
      headers: { authorization: "Bearer test-token" },
      payload: {}
    });

    expect(open.statusCode).toBe(200);
    const payload = open.json<{ profile: { id: string; name: string }; activeProfileId: string }>();
    expect(payload.profile.name).toBe("Gemini Persistent");
    expect(payload.activeProfileId).toBe(payload.profile.id);
  });
});
