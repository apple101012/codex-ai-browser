import { describe, expect, it, vi } from "vitest";
import type { ProfileRecord } from "../src/domain/profile.js";
import { ensureGeminiProfile } from "../src/scripts/ensureGeminiProfile.js";

const now = new Date().toISOString();

const baseProfile: ProfileRecord = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Browser Profile",
  engine: "chrome",
  settings: { headless: false },
  createdAt: now,
  updatedAt: now,
  dataDir: "C:\\profiles\\gemini",
  managedDataDir: false
};

describe("ensureGeminiProfile", () => {
  it("creates a Browser Profile when one does not exist", async () => {
    const mkdirFn = vi.fn<(targetPath: string, options: { recursive: true }) => Promise<unknown>>(
      async () => undefined
    );
    const init = vi.fn<() => Promise<void>>(async () => undefined);
    const findByName = vi.fn<(name: string) => Promise<ProfileRecord | null>>(async () => null);
    const create = vi.fn<(input: unknown) => Promise<ProfileRecord>>(async () => baseProfile);
    const update = vi.fn<(id: string, updates: unknown) => Promise<ProfileRecord | null>>(
      async () => baseProfile
    );

    const result = await ensureGeminiProfile({
      configLoader: () => ({
        host: "127.0.0.1",
        port: 4321,
        dataDir: "C:\\data",
        profilesDir: "C:\\profiles",
        artifactsDir: "C:\\artifacts",
        publicDir: "C:\\public",
        defaultHeadless: true,
        allowEvaluate: false,
        apiToken: undefined
      }),
      mkdirFn,
      homeDir: "C:\\Users\\testuser",
      createStore: () => ({
        init,
        findByName,
        create,
        update
      })
    });

    expect(result.created).toBe(true);
    expect(init).toHaveBeenCalledTimes(1);
    expect(findByName).toHaveBeenCalledWith("Browser Profile");
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    const createInput = create.mock.calls[0]?.[0] as {
      name: string;
      engine: string;
      settings: { headless: boolean };
      externalDataDir: string;
    };
    expect(createInput).toMatchObject({
      name: "Browser Profile",
      engine: "chrome",
      settings: { headless: false }
    });
    expect(createInput.externalDataDir).toContain(".codex\\playwright-profiles\\gemini");
  });

  it("updates existing Browser Profile", async () => {
    const existing: ProfileRecord = {
      ...baseProfile,
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    };
    const updatedProfile: ProfileRecord = {
      ...existing,
      updatedAt: new Date(Date.now() + 1000).toISOString()
    };
    const update = vi.fn<(id: string, updates: unknown) => Promise<ProfileRecord | null>>(
      async () => updatedProfile
    );

    const result = await ensureGeminiProfile({
      configLoader: () => ({
        host: "127.0.0.1",
        port: 4321,
        dataDir: "C:\\data",
        profilesDir: "C:\\profiles",
        artifactsDir: "C:\\artifacts",
        publicDir: "C:\\public",
        defaultHeadless: true,
        allowEvaluate: false,
        apiToken: undefined
      }),
      mkdirFn: vi.fn(async () => undefined),
      homeDir: "C:\\Users\\testuser",
      createStore: () => ({
        init: vi.fn(async () => undefined),
        findByName: vi.fn(async () => existing),
        create: vi.fn(async () => updatedProfile),
        update
      })
    });

    expect(result.created).toBe(false);
    expect(result.profile.id).toBe(existing.id);
    expect(update).toHaveBeenCalledWith(existing.id, {
      name: "Browser Profile",
      engine: "chrome",
      externalDataDir: "C:\\Users\\testuser\\.codex\\playwright-profiles\\gemini",
      settings: { headless: false }
    });
  });
});
