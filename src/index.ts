import { mkdir } from "node:fs/promises";
import { loadConfig } from "./config.js";
import { buildServer } from "./api/server.js";
import { ProfileStore } from "./storage/profileStore.js";
import { PlaywrightRuntime } from "./browser/playwrightRuntime.js";
import { ActiveControlStore } from "./control/activeControlStore.js";

const start = async (): Promise<void> => {
  const config = loadConfig();

  await mkdir(config.profilesDir, { recursive: true });
  await mkdir(config.artifactsDir, { recursive: true });

  const store = new ProfileStore(config.profilesDir);
  await store.init();

  const runtime = new PlaywrightRuntime({
    artifactsDir: config.artifactsDir,
    defaultHeadless: config.defaultHeadless,
    allowEvaluate: config.allowEvaluate
  });
  const controlStore = new ActiveControlStore();

  const app = buildServer({ config, store, runtime, controlStore });

  const shutdown = async (): Promise<void> => {
    await runtime.stopAll();
    await app.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await app.listen({
    host: config.host,
    port: config.port
  });
};

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
