import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import type { ProfileRecord } from "../domain/profile.js";

const INDEX_FILE_NAME = "backups-index.json";
const MANIFEST_FILE_NAME = "backup-manifest.json";

const BackupRecordSchema = z.object({
  id: z.string().uuid(),
  profileId: z.string().uuid(),
  profileName: z.string().min(1),
  createdAt: z.string().datetime(),
  label: z.string().min(1).max(200).optional(),
  backupDir: z.string().min(1),
  dataSnapshotDir: z.string().min(1),
  sourceDataDir: z.string().min(1),
  manifestPath: z.string().min(1)
});

export type ProfileBackupRecord = z.infer<typeof BackupRecordSchema>;

export interface CreateProfileBackupInput {
  profile: ProfileRecord;
  destinationDir?: string;
  label?: string;
}

const toSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "profile";

const normalizeForCompare = (value: string): string => path.resolve(value).replace(/[\\/]+/g, "/").toLowerCase();

const isNestedPath = (candidate: string, maybeParent: string): boolean => {
  const normalizedCandidate = normalizeForCompare(candidate);
  const normalizedParent = normalizeForCompare(maybeParent);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}/`);
};

export class ProfileBackupStore {
  private readonly indexRootDir: string;
  private readonly indexPath: string;
  private initPromise: Promise<void> | null = null;

  constructor(indexRootDir: string) {
    this.indexRootDir = indexRootDir;
    this.indexPath = path.join(indexRootDir, INDEX_FILE_NAME);
  }

  async init(): Promise<void> {
    await this.ensureInit();
  }

  async createBackup(input: CreateProfileBackupInput): Promise<ProfileBackupRecord> {
    await this.ensureInit();

    const destinationRoot = path.resolve(input.destinationDir?.trim() || this.indexRootDir);
    if (isNestedPath(destinationRoot, input.profile.dataDir)) {
      throw new Error("Backup destination cannot be inside the profile data directory.");
    }

    await mkdir(destinationRoot, { recursive: true });

    const createdAt = new Date().toISOString();
    const id = randomUUID();
    const shortId = id.slice(0, 8);
    const timestamp = createdAt.replace(/[:.]/g, "-");
    const backupDirName = `${toSlug(input.profile.name)}-${timestamp}-${shortId}`;
    const backupDir = path.join(destinationRoot, backupDirName);
    const dataSnapshotDir = path.join(backupDir, "data");
    const manifestPath = path.join(backupDir, MANIFEST_FILE_NAME);

    await mkdir(backupDir, { recursive: true });
    await cp(input.profile.dataDir, dataSnapshotDir, { recursive: true, force: true });

    const record: ProfileBackupRecord = BackupRecordSchema.parse({
      id,
      profileId: input.profile.id,
      profileName: input.profile.name,
      createdAt,
      label: input.label?.trim() || undefined,
      backupDir,
      dataSnapshotDir,
      sourceDataDir: input.profile.dataDir,
      manifestPath
    });

    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          backupId: record.id,
          profileId: record.profileId,
          profileName: record.profileName,
          createdAt: record.createdAt,
          label: record.label,
          sourceDataDir: record.sourceDataDir
        },
        null,
        2
      ),
      "utf-8"
    );

    const records = await this.readIndex();
    records.push(record);
    await this.writeIndex(records);

    return record;
  }

  async listBackups(options?: { profileId?: string; limit?: number }): Promise<ProfileBackupRecord[]> {
    await this.ensureInit();

    const records = await this.readIndex();
    const filtered = options?.profileId
      ? records.filter((record) => record.profileId === options.profileId)
      : records;
    const sorted = [...filtered].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    if (options?.limit !== undefined) {
      const bounded = Math.max(1, Math.min(options.limit, 500));
      return sorted.slice(0, bounded);
    }
    return sorted;
  }

  async getBackup(backupId: string): Promise<ProfileBackupRecord | null> {
    await this.ensureInit();
    const records = await this.readIndex();
    return records.find((record) => record.id === backupId) ?? null;
  }

  async restoreBackup(profile: ProfileRecord, backup: ProfileBackupRecord): Promise<void> {
    await this.ensureInit();

    if (backup.profileId !== profile.id) {
      throw new Error("Backup does not belong to this profile.");
    }

    await stat(backup.dataSnapshotDir);

    await rm(profile.dataDir, { recursive: true, force: true });
    await mkdir(path.dirname(profile.dataDir), { recursive: true });
    await cp(backup.dataSnapshotDir, profile.dataDir, { recursive: true, force: true });
  }

  private async ensureInit(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        await mkdir(this.indexRootDir, { recursive: true });
        const existing = await this.readIndexSafe();
        if (existing === null) {
          await this.writeIndex([]);
        }
      })();
    }
    await this.initPromise;
  }

  private async readIndex(): Promise<ProfileBackupRecord[]> {
    const raw = await this.readIndexSafe();
    if (raw === null) {
      return [];
    }
    return raw.map((value) => BackupRecordSchema.parse(value));
  }

  private async readIndexSafe(): Promise<unknown[] | null> {
    try {
      const file = await readFile(this.indexPath, "utf-8");
      const parsed = JSON.parse(file) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("Backup index file is not an array.");
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

  private async writeIndex(records: ProfileBackupRecord[]): Promise<void> {
    const serialized = JSON.stringify(records, null, 2);
    const tmpPath = `${this.indexPath}.tmp`;
    await writeFile(tmpPath, serialized, "utf-8");
    await writeFile(this.indexPath, serialized, "utf-8");
    await rm(tmpPath, { force: true });
  }
}
