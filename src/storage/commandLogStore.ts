import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserCommand, CommandExecutionResult } from "../domain/commands.js";

export interface CommandLogEntry {
  ts: string;
  commands: BrowserCommand[];
  durationMs: number;
  results: CommandExecutionResult[];
}

const LOG_FILE_NAME = "command-log.jsonl";

export class CommandLogStore {
  logPath(dataDir: string): string {
    return path.join(dataDir, LOG_FILE_NAME);
  }

  async append(dataDir: string, entry: CommandLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.logPath(dataDir), line, "utf8");
  }

  async readLast(dataDir: string, limit = 100): Promise<CommandLogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.logPath(dataDir), "utf8");
    } catch (err: any) {
      if (err?.code === "ENOENT") return [];
      throw err;
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const tail = lines.slice(-limit);
    const entries: CommandLogEntry[] = [];
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line) as CommandLogEntry);
      } catch {
        // skip malformed lines
      }
    }
    return entries;
  }
}
