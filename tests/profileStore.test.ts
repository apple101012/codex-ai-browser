import { afterEach, describe, expect, it } from "vitest";
import path from "node:path";
import { ProfileStore } from "../src/storage/profileStore.js";
import { createTempDir, removeDir } from "./testUtils.js";

const dirsToClean: string[] = [];

afterEach(async () => {
  while (dirsToClean.length > 0) {
    const dir = dirsToClean.pop();
    if (dir) {
      await removeDir(dir);
    }
  }
});

describe("ProfileStore", () => {
  it("creates, lists, updates, and deletes profiles", async () => {
    const root = await createTempDir("profile-store-");
    dirsToClean.push(root);

    const store = new ProfileStore(path.join(root, "profiles"));
    await store.init();

    const created = await store.create({
      name: "Main profile",
      engine: "chromium",
      settings: {
        userAgent: "MyAgent/1.0"
      }
    });

    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(created.settings.userAgent).toBe("MyAgent/1.0");

    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);

    const updated = await store.update(created.id, {
      settings: {
        userAgent: "MyAgent/2.0",
        proxy: { server: "http://127.0.0.1:8888" }
      }
    });

    expect(updated).not.toBeNull();
    expect(updated?.settings.userAgent).toBe("MyAgent/2.0");
    expect(updated?.settings.proxy?.server).toBe("http://127.0.0.1:8888");

    const deleted = await store.delete(created.id);
    expect(deleted).toBe(true);

    const empty = await store.list();
    expect(empty).toHaveLength(0);
  });
});

