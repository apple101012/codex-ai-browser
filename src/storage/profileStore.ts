import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  CreateProfileInputSchema,
  type CreateProfileInput,
  type ProfileRecord,
  ProfileRecordSchema,
  UpdateProfileInputSchema,
  type UpdateProfileInput
} from "../domain/profile.js";

const INDEX_FILE_NAME = "profiles-index.json";

export class ProfileStore {
  private readonly rootDir: string;
  private readonly indexPath: string;
  private readonly profileDataDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
    this.indexPath = path.join(rootDir, INDEX_FILE_NAME);
    this.profileDataDir = path.join(rootDir, "profile-data");
  }

  async init(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await mkdir(this.profileDataDir, { recursive: true });
    const exists = await this.readIndexSafe();
    if (exists === null) {
      await this.writeIndex([]);
    }
  }

  async list(): Promise<ProfileRecord[]> {
    const records = await this.readIndex();
    return [...records].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async get(profileId: string): Promise<ProfileRecord | null> {
    const records = await this.readIndex();
    return records.find((record) => record.id === profileId) ?? null;
  }

  async findByName(name: string): Promise<ProfileRecord | null> {
    const records = await this.readIndex();
    return records.find((record) => record.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
  }

  async create(input: CreateProfileInput): Promise<ProfileRecord> {
    const payload = CreateProfileInputSchema.parse(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    const externalDataDir = payload.externalDataDir?.trim();
    const dataDir = externalDataDir ? path.resolve(externalDataDir) : path.join(this.profileDataDir, id);
    const managedDataDir = !externalDataDir;

    await mkdir(dataDir, { recursive: true });

    const record: ProfileRecord = ProfileRecordSchema.parse({
      id,
      name: payload.name,
      engine: payload.engine,
      settings: payload.settings,
      createdAt: now,
      updatedAt: now,
      dataDir,
      managedDataDir
    });

    const records = await this.readIndex();
    records.push(record);
    await this.writeIndex(records);
    return record;
  }

  async update(profileId: string, input: UpdateProfileInput): Promise<ProfileRecord | null> {
    const payload = UpdateProfileInputSchema.parse(input);
    const records = await this.readIndex();
    const index = records.findIndex((record) => record.id === profileId);
    if (index === -1) {
      return null;
    }

    const current = records[index];
    if (!current) {
      return null;
    }
    const nextRecord: ProfileRecord = ProfileRecordSchema.parse({
      ...current,
      name: payload.name ?? current.name,
      engine: payload.engine ?? current.engine,
      settings: {
        ...current.settings,
        ...(payload.settings ?? {}),
        proxy: payload.settings?.proxy === undefined ? current.settings.proxy : payload.settings.proxy
      },
      dataDir: payload.externalDataDir ? path.resolve(payload.externalDataDir.trim()) : current.dataDir,
      managedDataDir: payload.externalDataDir ? false : current.managedDataDir,
      updatedAt: new Date().toISOString()
    });

    await mkdir(nextRecord.dataDir, { recursive: true });

    records[index] = nextRecord;
    await this.writeIndex(records);
    return nextRecord;
  }

  async delete(profileId: string): Promise<boolean> {
    const records = await this.readIndex();
    const existing = records.find((record) => record.id === profileId);
    if (!existing) {
      return false;
    }

    const nextRecords = records.filter((record) => record.id !== profileId);
    await this.writeIndex(nextRecords);
    if (existing.managedDataDir) {
      await rm(existing.dataDir, { recursive: true, force: true });
    }
    return true;
  }

  private async readIndex(): Promise<ProfileRecord[]> {
    const raw = await this.readIndexSafe();
    if (raw === null) {
      return [];
    }
    return raw.map((record) => ProfileRecordSchema.parse(record));
  }

  private async readIndexSafe(): Promise<unknown[] | null> {
    try {
      const file = await readFile(this.indexPath, "utf-8");
      const parsed = JSON.parse(file) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Profile index file is not an array.");
      }
      return parsed;
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "ENOENT"
      ) {
        return null;
      }
      throw error;
    }
  }

  private async writeIndex(records: ProfileRecord[]): Promise<void> {
    const tmpPath = `${this.indexPath}.tmp`;
    const serialized = JSON.stringify(records, null, 2);
    await writeFile(tmpPath, serialized, "utf-8");
    await writeFile(this.indexPath, serialized, "utf-8");
    await rm(tmpPath, { force: true });
  }
}
