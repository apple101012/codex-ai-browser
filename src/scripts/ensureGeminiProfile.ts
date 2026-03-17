import os from "node:os";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { loadConfig } from "../config.js";
import { ProfileStore } from "../storage/profileStore.js";

const GEMINI_PROFILE_NAME = "Gemini Persistent";

const main = async (): Promise<void> => {
  const config = loadConfig();
  await mkdir(config.profilesDir, { recursive: true });
  const store = new ProfileStore(config.profilesDir);
  await store.init();

  const geminiDir = path.join(os.homedir(), ".codex", "playwright-profiles", "gemini");

  const existing = await store.findByName(GEMINI_PROFILE_NAME);
  if (!existing) {
    const profile = await store.create({
      name: GEMINI_PROFILE_NAME,
      engine: "chromium",
      externalDataDir: geminiDir,
      settings: {
        headless: false
      }
    });
    console.log(JSON.stringify({ created: true, profile }, null, 2));
    return;
  }

  const updated = await store.update(existing.id, {
    engine: "chromium",
    externalDataDir: geminiDir,
    settings: {
      headless: false
    }
  });

  console.log(JSON.stringify({ created: false, profile: updated }, null, 2));
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

