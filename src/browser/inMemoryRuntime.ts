import type { BrowserRuntime } from "./runtime.js";
import type { BrowserCommand, CommandExecutionResult } from "../domain/commands.js";
import type { ProfileRecord } from "../domain/profile.js";
import type { Cookie } from "playwright";

export class InMemoryRuntime implements BrowserRuntime {
  private readonly runningProfiles = new Set<string>();

  async start(profile: ProfileRecord): Promise<void> {
    this.runningProfiles.add(profile.id);
  }

  async stop(profileId: string): Promise<void> {
    this.runningProfiles.delete(profileId);
  }

  async stopAll(): Promise<void> {
    this.runningProfiles.clear();
  }

  isRunning(profileId: string): boolean {
    return this.runningProfiles.has(profileId);
  }

  listRunningIds(): string[] {
    return [...this.runningProfiles.values()];
  }

  async execute(profile: ProfileRecord, command: BrowserCommand): Promise<CommandExecutionResult> {
    if (!this.isRunning(profile.id)) {
      throw new Error(`Profile ${profile.id} is not running.`);
    }

    return {
      type: command.type,
      ok: true,
      data: {
        mock: true,
        profileId: profile.id,
        command
      }
    };
  }

  async getCookies(_profileId: string, _urls?: string[]): Promise<Cookie[]> {
    return [];
  }

  async addCookies(_profileId: string, _cookies: Cookie[]): Promise<void> {
    // no-op in mock runtime
  }
}

