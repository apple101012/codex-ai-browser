import type { BrowserCommand, CommandExecutionResult } from "../domain/commands.js";
import type { ProfileRecord } from "../domain/profile.js";

export interface BrowserRuntime {
  start(profile: ProfileRecord): Promise<void>;
  stop(profileId: string): Promise<void>;
  stopAll(): Promise<void>;
  isRunning(profileId: string): boolean;
  listRunningIds(): string[];
  execute(profile: ProfileRecord, command: BrowserCommand): Promise<CommandExecutionResult>;
}

