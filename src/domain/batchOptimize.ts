import type { BrowserCommand } from "./commands.js";

/**
 * Apply batch optimization to a command list: set includeStateAfter=false
 * on all non-last commands that don't already have it explicitly set.
 * Returns a new array (does not mutate inputs).
 */
export function applyBatchStateSkip(commands: BrowserCommand[]): BrowserCommand[] {
  const count = commands.length;
  return commands.map((command, i) => {
    const isLast = i === count - 1;
    if (!isLast && !("includeStateAfter" in command)) {
      return Object.assign({}, command, { includeStateAfter: false });
    }
    return command;
  });
}
