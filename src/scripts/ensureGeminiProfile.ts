import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { loadConfig } from "../config.js";
import { ProfileStore } from "../storage/profileStore.js";
import type { ProfileRecord } from "../domain/profile.js";

const DEFAULT_BROWSER_PROFILE_NAME = "Browser Profile";
const LEGACY_GEMINI_PROFILE_NAME = "Gemini Persistent";

interface GeminiStore {
  init(): Promise<void>;
  findByName(name: string): Promise<ProfileRecord | null>;
  create(input: {
    name: string;
    engine: "chrome";
    externalDataDir: string;
    settings: { headless: false };
  }): Promise<ProfileRecord>;
  update(
    id: string,
    updates: {
      name: string;
      engine: "chrome";
      externalDataDir: string;
      settings: { headless: false };
    }
  ): Promise<ProfileRecord | null>;
}

export interface EnsureGeminiProfileResult {
  created: boolean;
  profile: ProfileRecord;
}

export interface EnsureGeminiProfileDeps {
  configLoader?: typeof loadConfig;
  mkdirFn?: (targetPath: string, options: { recursive: true }) => Promise<unknown>;
  homeDir?: string;
  createStore?: (profilesDir: string) => GeminiStore;
}

export const ensureGeminiProfile = async (
  deps: EnsureGeminiProfileDeps = {}
): Promise<EnsureGeminiProfileResult> => {
  const config = (deps.configLoader ?? loadConfig)();
  await (deps.mkdirFn ?? mkdir)(config.profilesDir, { recursive: true });
  const store = (deps.createStore ?? ((profilesDir) => new ProfileStore(profilesDir)))(config.profilesDir);
  await store.init();

  const geminiDir = path.join(
    deps.homeDir ?? os.homedir(),
    ".codex",
    "playwright-profiles",
    "gemini"
  );

  const existingByDefaultName = await store.findByName(DEFAULT_BROWSER_PROFILE_NAME);
  const existingByLegacyName = existingByDefaultName ? null : await store.findByName(LEGACY_GEMINI_PROFILE_NAME);
  const existing = existingByDefaultName ?? existingByLegacyName;
  if (!existing) {
    const profile = await store.create({
      name: DEFAULT_BROWSER_PROFILE_NAME,
      engine: "chrome",
      externalDataDir: geminiDir,
      settings: {
        headless: false
      }
    });
    return { created: true, profile };
  }

  const updated = await store.update(existing.id, {
    name: DEFAULT_BROWSER_PROFILE_NAME,
    engine: "chrome",
    externalDataDir: geminiDir,
    settings: {
      headless: false
    }
  });
  if (!updated) {
    throw new Error(`Failed to update profile ${existing.id}`);
  }

  return { created: false, profile: updated };
};

const main = async (): Promise<void> => {
  const result = await ensureGeminiProfile();
  console.log(JSON.stringify(result, null, 2));
};

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (isMain) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
