import { mkdir } from "node:fs/promises";
import { loadConfig, type AppConfig } from "./config.js";
import { buildServer } from "./api/server.js";
import { ProfileStore } from "./storage/profileStore.js";
import { PlaywrightRuntime } from "./browser/playwrightRuntime.js";
import { ActiveControlStore } from "./control/activeControlStore.js";

export interface StartServerOptions {
  host?: string;
  port?: number;
  registerSignalHandlers?: boolean;
}

export interface RunningServer {
  host: string;
  port: number;
  close: () => Promise<void>;
}

const buildConfig = (options: StartServerOptions): AppConfig => {
  const config = loadConfig();
  return {
    ...config,
    host: options.host ?? config.host,
    port: options.port ?? config.port
  };
};

export const startServer = async (options: StartServerOptions = {}): Promise<RunningServer> => {
  const config = buildConfig(options);

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

  const close = async (): Promise<void> => {
    await runtime.stopAll();
    await app.close();
  };

  if (options.registerSignalHandlers ?? true) {
    const shutdown = async (): Promise<void> => {
      await close();
      process.exit(0);
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }

  await app.listen({
    host: config.host,
    port: config.port
  });

  return {
    host: config.host,
    port: config.port,
    close
  };
};

