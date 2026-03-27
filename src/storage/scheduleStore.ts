import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { BrowserCommand } from "../domain/commands.js";

const INDEX_FILE_NAME = "schedules-index.json";

export const CreateScheduleInputSchema = z.object({
  profileId: z.string().uuid(),
  commands: z.array(z.any()).min(1),
  intervalMs: z.number().int().min(1000),
  enabled: z.boolean().default(true),
  label: z.string().max(200).optional()
});

export type CreateScheduleInput = z.infer<typeof CreateScheduleInputSchema>;

export interface ScheduleRecord {
  id: string;
  profileId: string;
  commands: BrowserCommand[];
  intervalMs: number;
  enabled: boolean;
  label?: string;
  lastRunAt: string | null;
  createdAt: string;
}

export class ScheduleStore {
  private readonly dir: string;
  private readonly indexPath: string;

  constructor(dir: string) {
    this.dir = dir;
    this.indexPath = path.join(dir, INDEX_FILE_NAME);
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    try {
      await readFile(this.indexPath, "utf8");
    } catch {
      await writeFile(this.indexPath, JSON.stringify([]), "utf8");
    }
  }

  private async readIndex(): Promise<ScheduleRecord[]> {
    try {
      const raw = await readFile(this.indexPath, "utf8");
      return JSON.parse(raw) as ScheduleRecord[];
    } catch {
      return [];
    }
  }

  private async writeIndex(records: ScheduleRecord[]): Promise<void> {
    const tmp = this.indexPath + ".tmp";
    await writeFile(tmp, JSON.stringify(records, null, 2), "utf8");
    // Attempt atomic rename. On Windows, rename over an existing file can throw EPERM,
    // so fall back to a direct write if rename fails.
    try {
      await rename(tmp, this.indexPath);
    } catch {
      // Fallback: write directly. Not atomic but safe for our use case.
      await writeFile(this.indexPath, JSON.stringify(records, null, 2), "utf8");
      try { await unlink(tmp); } catch { /* best effort cleanup */ }
    }
  }

  async list(): Promise<ScheduleRecord[]> {
    return this.readIndex();
  }

  async get(id: string): Promise<ScheduleRecord | undefined> {
    const all = await this.readIndex();
    return all.find((s) => s.id === id);
  }

  async create(input: CreateScheduleInput): Promise<ScheduleRecord> {
    const all = await this.readIndex();
    const record: ScheduleRecord = {
      id: randomUUID(),
      profileId: input.profileId,
      commands: input.commands as BrowserCommand[],
      intervalMs: input.intervalMs,
      enabled: input.enabled ?? true,
      label: input.label,
      lastRunAt: null,
      createdAt: new Date().toISOString()
    };
    all.push(record);
    await this.writeIndex(all);
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const all = await this.readIndex();
    const idx = all.findIndex((s) => s.id === id);
    if (idx === -1) return false;
    all.splice(idx, 1);
    await this.writeIndex(all);
    return true;
  }

  async markRan(id: string): Promise<void> {
    const all = await this.readIndex();
    const record = all.find((s) => s.id === id);
    if (record) {
      record.lastRunAt = new Date().toISOString();
      await this.writeIndex(all);
    }
  }

  async setEnabled(id: string, enabled: boolean): Promise<boolean> {
    const all = await this.readIndex();
    const record = all.find((s) => s.id === id);
    if (!record) return false;
    record.enabled = enabled;
    await this.writeIndex(all);
    return true;
  }

  async setLabel(id: string, label: string | undefined): Promise<boolean> {
    const all = await this.readIndex();
    const record = all.find((s) => s.id === id);
    if (!record) return false;
    record.label = label;
    await this.writeIndex(all);
    return true;
  }
}
