import type { ScheduleStore } from "../storage/scheduleStore.js";
import type { CommandLogStore } from "../storage/commandLogStore.js";
import type { ProfileStore } from "../storage/profileStore.js";
import type { BrowserRuntime } from "../browser/runtime.js";
import type { CommandExecutionResult } from "../domain/commands.js";
import { applyBatchStateSkip } from "../domain/batchOptimize.js";

export class ScheduleRunner {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly running = new Set<string>();

  constructor(
    private readonly scheduleStore: ScheduleStore,
    private readonly profileStore: ProfileStore,
    private readonly runtime: BrowserRuntime,
    private readonly commandLogStore: CommandLogStore
  ) {}

  async bootAll(): Promise<void> {
    const schedules = await this.scheduleStore.list();
    for (const s of schedules) {
      if (s.enabled) this.register(s.id, s.intervalMs);
    }
  }

  register(id: string, intervalMs: number): void {
    this.unregister(id);
    const timer = setInterval(() => {
      this.runSchedule(id).catch((err) =>
        console.warn(`[scheduler] schedule ${id} run failed:`, err)
      );
    }, intervalMs);
    // allow the process to exit cleanly even if timers are pending
    if (typeof timer.unref === "function") timer.unref();
    this.timers.set(id, timer);
  }

  unregister(id: string): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(id);
    }
  }

  async runSchedule(id: string): Promise<void> {
    if (this.running.has(id)) {
      console.warn(`[scheduler] schedule ${id} already running — skipping`);
      return;
    }
    this.running.add(id);
    try {
      const schedule = await this.scheduleStore.get(id);
      if (!schedule || !schedule.enabled) return;

      const profile = await this.profileStore.get(schedule.profileId);
      if (!profile) {
        console.warn(`[scheduler] schedule ${id}: profile ${schedule.profileId} not found`);
        return;
      }

      // Auto-start profile if not running
      if (!this.runtime.isRunning(profile.id)) {
        await this.runtime.start(profile);
      }

      const startTime = Date.now();
      const results: CommandExecutionResult[] = [];
      const optimizedCommands = applyBatchStateSkip(schedule.commands);
      for (const command of optimizedCommands) {
        try {
          const result = await this.runtime.execute(profile, command);
          results.push(result);
        } catch (err) {
          results.push({ type: command.type, ok: false, error: String(err) });
        }
      }
      const durationMs = Date.now() - startTime;

      this.commandLogStore
        .append(profile.dataDir, {
          ts: new Date().toISOString(),
          commands: schedule.commands,
          durationMs,
          results
        })
        .catch((err) => console.warn("[scheduler] failed to write command log:", err));

      await this.scheduleStore.markRan(id);
    } finally {
      this.running.delete(id);
    }
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  stopAll(): void {
    for (const id of this.timers.keys()) {
      this.unregister(id);
    }
  }
}
