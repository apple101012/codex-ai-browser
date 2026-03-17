import path from "node:path";

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
};

export interface AppConfig {
  host: string;
  port: number;
  dataDir: string;
  profilesDir: string;
  artifactsDir: string;
  publicDir: string;
  apiToken?: string;
  defaultHeadless: boolean;
  allowEvaluate: boolean;
}

export const loadConfig = (): AppConfig => {
  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.PORT ?? "4321", 10);
  const dataDir = path.resolve(process.cwd(), process.env.DATA_DIR ?? "./data");
  const profilesDir = path.join(dataDir, "profiles");
  const artifactsDir = path.join(dataDir, "artifacts");
  const publicDir = path.resolve(process.cwd(), "public");

  return {
    host,
    port: Number.isNaN(port) ? 4321 : port,
    dataDir,
    profilesDir,
    artifactsDir,
    publicDir,
    apiToken: process.env.API_TOKEN?.trim() || undefined,
    defaultHeadless: parseBoolean(process.env.DEFAULT_HEADLESS, true),
    allowEvaluate: parseBoolean(process.env.ALLOW_EVALUATE, false)
  };
};
