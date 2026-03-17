import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
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

  it("redirects root path to /app without auth", async () => {
    const response = await app.inject({
      method: "GET",
      path: "/"
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/app");
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
    expect(payload.profile?.name).toBe("Browser Profile");
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
    expect(payload.profile.name).toBe("Browser Profile");
    expect(payload.activeProfileId).toBe(payload.profile.id);
  });

  it("stops all running profiles and clears active profile", async () => {
    const createdIds: string[] = [];

    for (const name of ["Stop All A", "Stop All B"]) {
      const create = await app.inject({
        method: "POST",
        path: "/profiles",
        headers: { authorization: "Bearer test-token" },
        payload: {
          name,
          engine: "chromium",
          settings: {}
        }
      });
      expect(create.statusCode).toBe(201);
      createdIds.push(create.json<{ profile: { id: string } }>().profile.id);
    }

    for (const profileId of createdIds) {
      const started = await app.inject({
        method: "POST",
        path: `/profiles/${profileId}/start`,
        headers: { authorization: "Bearer test-token" },
        payload: {}
      });
      expect(started.statusCode).toBe(200);
    }

    const setActive = await app.inject({
      method: "POST",
      path: "/control/active-profile",
      headers: { authorization: "Bearer test-token" },
      payload: {
        profileId: createdIds[0],
        autoStart: true
      }
    });
    expect(setActive.statusCode).toBe(200);

    const stopAll = await app.inject({
      method: "POST",
      path: "/profiles/stop-all",
      headers: { authorization: "Bearer test-token" },
      payload: {}
    });
    expect(stopAll.statusCode).toBe(200);
    const stopAllPayload = stopAll.json<{ stoppedCount: number; activeProfileId: string | null }>();
    expect(stopAllPayload.stoppedCount).toBe(2);
    expect(stopAllPayload.activeProfileId).toBeNull();
  });

  it("opens arbitrary URL using active profile control", async () => {
    const create = await app.inject({
      method: "POST",
      path: "/profiles",
      headers: { authorization: "Bearer test-token" },
      payload: {
        name: "Open URL profile",
        engine: "chromium",
        settings: {}
      }
    });
    expect(create.statusCode).toBe(201);
    const profileId = create.json<{ profile: { id: string } }>().profile.id;

    const openUrl = await app.inject({
      method: "POST",
      path: "/control/open-url",
      headers: { authorization: "Bearer test-token" },
      payload: {
        profileId,
        url: "https://example.com/",
        autoSetActive: true,
        autoStart: true
      }
    });
    expect(openUrl.statusCode).toBe(200);
    const payload = openUrl.json<{ activeProfileId: string; navigate: { ok: boolean } }>();
    expect(payload.activeProfileId).toBe(profileId);
    expect(payload.navigate.ok).toBe(true);
  });

  it("toggles profile visibility mode and auto-starts when requested", async () => {
    const create = await app.inject({
      method: "POST",
      path: "/profiles",
      headers: { authorization: "Bearer test-token" },
      payload: {
        name: "Visibility profile",
        engine: "chromium",
        settings: {
          headless: true
        }
      }
    });
    expect(create.statusCode).toBe(201);
    const profileId = create.json<{ profile: { id: string } }>().profile.id;

    const show = await app.inject({
      method: "POST",
      path: `/profiles/${profileId}/visibility`,
      headers: { authorization: "Bearer test-token" },
      payload: {
        visible: true,
        autoStart: true
      }
    });
    expect(show.statusCode).toBe(200);
    const showPayload = show.json<{ visible: boolean; started: boolean; profile: { settings: { headless?: boolean } } }>();
    expect(showPayload.visible).toBe(true);
    expect(showPayload.started).toBe(true);
    expect(showPayload.profile.settings.headless).toBe(false);

    const hide = await app.inject({
      method: "POST",
      path: `/profiles/${profileId}/visibility`,
      headers: { authorization: "Bearer test-token" },
      payload: {
        visible: false
      }
    });
    expect(hide.statusCode).toBe(200);
    const hidePayload = hide.json<{ visible: boolean; restarted: boolean; profile: { settings: { headless?: boolean } } }>();
    expect(hidePayload.visible).toBe(false);
    expect(hidePayload.restarted).toBe(true);
    expect(hidePayload.profile.settings.headless).toBe(true);
  });

  it("creates and restores profile backups", async () => {
    const create = await app.inject({
      method: "POST",
      path: "/profiles",
      headers: { authorization: "Bearer test-token" },
      payload: {
        name: "Backup profile",
        engine: "chromium",
        settings: {}
      }
    });
    expect(create.statusCode).toBe(201);
    const profile = create.json<{ profile: { id: string; dataDir: string } }>().profile;

    const stateFile = path.join(profile.dataDir, "state.txt");
    await writeFile(stateFile, "initial-state", "utf-8");

    const backupResp = await app.inject({
      method: "POST",
      path: `/profiles/${profile.id}/backup`,
      headers: { authorization: "Bearer test-token" },
      payload: { label: "before-change" }
    });
    expect(backupResp.statusCode).toBe(200);
    const backupPayload = backupResp.json<{ backup: { id: string; profileId: string } }>();
    expect(backupPayload.backup.profileId).toBe(profile.id);

    await writeFile(stateFile, "changed-state", "utf-8");

    const restoreResp = await app.inject({
      method: "POST",
      path: `/profiles/${profile.id}/restore`,
      headers: { authorization: "Bearer test-token" },
      payload: {
        backupId: backupPayload.backup.id
      }
    });
    expect(restoreResp.statusCode).toBe(200);
    const restored = restoreResp.json<{ restored: boolean }>();
    expect(restored.restored).toBe(true);

    const finalState = await readFile(stateFile, "utf-8");
    expect(finalState).toBe("initial-state");

    const listByProfile = await app.inject({
      method: "GET",
      path: `/profiles/${profile.id}/backups`,
      headers: { authorization: "Bearer test-token" }
    });
    expect(listByProfile.statusCode).toBe(200);
    const listProfilePayload = listByProfile.json<{ backups: Array<{ id: string }> }>();
    expect(listProfilePayload.backups.some((backup) => backup.id === backupPayload.backup.id)).toBe(true);

    const listAll = await app.inject({
      method: "GET",
      path: "/backups",
      headers: { authorization: "Bearer test-token" }
    });
    expect(listAll.statusCode).toBe(200);
    const listAllPayload = listAll.json<{ backups: Array<{ id: string }> }>();
    expect(listAllPayload.backups.some((backup) => backup.id === backupPayload.backup.id)).toBe(true);
  });
});
