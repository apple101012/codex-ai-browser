import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { buildServer } from "../src/api/server.js";
import { ProfileStore } from "../src/storage/profileStore.js";
import { InMemoryRuntime } from "../src/browser/inMemoryRuntime.js";
import { ActiveControlStore } from "../src/control/activeControlStore.js";
import type { AppConfig } from "../src/config.js";
import { createTempDir, removeDir } from "./testUtils.js";

describe("Multi-profile workflow", () => {
  let tempDir: string;
  let app: ReturnType<typeof buildServer>;

  beforeEach(async () => {
    tempDir = await createTempDir("workflow-test-");
    const store = new ProfileStore(path.join(tempDir, "profiles"));
    await store.init();

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

    app = buildServer({
      config,
      store,
      runtime: new InMemoryRuntime(),
      controlStore: new ActiveControlStore()
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await removeDir(tempDir);
  });

  it("creates three profiles and runs active-profile commands", async () => {
    const profileIds: string[] = [];

    for (const name of ["Profile A", "Profile B", "Profile C"]) {
      const create = await app.inject({
        method: "POST",
        path: "/profiles",
        headers: { authorization: "Bearer test-token" },
        payload: {
          name,
          engine: "chrome",
          settings: {}
        }
      });
      expect(create.statusCode).toBe(201);
      const payload = create.json<{ profile: { id: string } }>();
      profileIds.push(payload.profile.id);
    }

    const setActive = await app.inject({
      method: "POST",
      path: "/control/active-profile",
      headers: { authorization: "Bearer test-token" },
      payload: {
        profileId: profileIds[1],
        autoStart: true
      }
    });
    expect(setActive.statusCode).toBe(200);

    const run = await app.inject({
      method: "POST",
      path: "/control/active/commands",
      headers: { authorization: "Bearer test-token" },
      payload: {
        commands: [{ type: "getTabText", tabIndex: 2, maxChars: 1200 }]
      }
    });

    expect(run.statusCode).toBe(200);
    const runPayload = run.json<{ profileId: string; successCount: number; total: number }>();
    expect(runPayload.profileId).toBe(profileIds[1]);
    expect(runPayload.successCount).toBe(1);
    expect(runPayload.total).toBe(1);
  });

  it("backs up and restores three separate profiles", async () => {
    const created: Array<{ id: string; dataDir: string }> = [];

    for (const [index, name] of ["Backup A", "Backup B", "Backup C"].entries()) {
      const create = await app.inject({
        method: "POST",
        path: "/profiles",
        headers: { authorization: "Bearer test-token" },
        payload: {
          name,
          engine: "chrome",
          settings: {}
        }
      });
      expect(create.statusCode).toBe(201);
      const payload = create.json<{ profile: { id: string; dataDir: string } }>();
      created.push({ id: payload.profile.id, dataDir: payload.profile.dataDir });

      const stateFile = path.join(payload.profile.dataDir, "state.txt");
      await writeFile(stateFile, `initial-${index}`, "utf-8");
    }

    const backupIds: string[] = [];
    for (const profile of created) {
      const backup = await app.inject({
        method: "POST",
        path: `/profiles/${profile.id}/backup`,
        headers: { authorization: "Bearer test-token" },
        payload: {}
      });
      expect(backup.statusCode).toBe(200);
      backupIds.push(backup.json<{ backup: { id: string } }>().backup.id);
    }

    for (const [index, profile] of created.entries()) {
      const stateFile = path.join(profile.dataDir, "state.txt");
      await writeFile(stateFile, `mutated-${index}`, "utf-8");
    }

    for (const [index, profile] of created.entries()) {
      const restore = await app.inject({
        method: "POST",
        path: `/profiles/${profile.id}/restore`,
        headers: { authorization: "Bearer test-token" },
        payload: {
          backupId: backupIds[index]
        }
      });
      expect(restore.statusCode).toBe(200);

      const stateFile = path.join(profile.dataDir, "state.txt");
      const restoredState = await readFile(stateFile, "utf-8");
      expect(restoredState).toBe(`initial-${index}`);
    }
  });
});
