import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const createTempDir = async (prefix: string): Promise<string> =>
  mkdtemp(path.join(os.tmpdir(), prefix));

export const removeDir = async (dirPath: string): Promise<void> => {
  await rm(dirPath, { recursive: true, force: true });
};

