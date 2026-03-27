import { mkdir } from "node:fs/promises";
import path from "node:path";
import { loadConfig, type AppConfig } from "./config.js";
import { buildServer } from "./api/server.js";
import { ProfileStore } from "./storage/profileStore.js";
import { ProfileBackupStore } from "./storage/profileBackupStore.js";
import { PlaywrightRuntime } from "./browser/playwrightRuntime.js";
import { ActiveControlStore } from "./control/activeControlStore.js";
import { CommandLogStore } from "./storage/commandLogStore.js";
import { ScheduleStore } from "./storage/scheduleStore.js";
import { ScheduleRunner } from "./scheduler/scheduleRunner.js";

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
  const backupDir = config.backupDir ?? path.join(config.dataDir, "backups");
  await mkdir(backupDir, { recursive: true });

  const store = new ProfileStore(config.profilesDir);
  await store.init();
  const backupStore = new ProfileBackupStore(backupDir);
  await backupStore.init();

  const runtime = new PlaywrightRuntime({
    artifactsDir: config.artifactsDir,
    defaultHeadless: config.defaultHeadless,
    allowEvaluate: config.allowEvaluate,
    profileStore: store,
    enableAcceleratorExtension: config.enableAcceleratorExtension,
    acceleratorExtensionDir: config.acceleratorExtensionDir,
    enableSnapshotCache: config.enableSnapshotCache
  });
  const controlStore = new ActiveControlStore();

  const schedulesDir = path.join(config.dataDir, "schedules");
  await mkdir(schedulesDir, { recursive: true });
  const commandLogStore = new CommandLogStore();
  const scheduleStore = new ScheduleStore(schedulesDir);
  await scheduleStore.init();
  const scheduleRunner = new ScheduleRunner(scheduleStore, store, runtime, commandLogStore);
  await scheduleRunner.bootAll();

  const app = buildServer({ config, store, runtime, controlStore, backupStore, commandLogStore, scheduleStore, scheduleRunner });

  const close = async (): Promise<void> => {
    scheduleRunner.stopAll();
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
